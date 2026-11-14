#!/usr/bin/env python3
"""Project Zebra prompt-DB validator (standard library only).

Shared module: `mksap_abim_parser.py` imports `validate_db` / `normalize` from here.

CLI:
    uv run --no-project tools/validate_db.py PATH [--min-answers N]
Exit code 0 = valid, 1 = errors (or unreadable file).

DB schema (version 1):
{"version":1, "generated_at":ISO8601, "generator":str, "review_status":"unreviewed",
 "prompts":[{"id","category","prompt","difficulty":"standard"|"impossible","source",
             "answers":[{"name","aliases":[...],"score":int,"pearl"?:str}]}]}
Scores: -10 (Board Prep Trap) or 1..100; 100 only on "impossible" prompts.
"""
import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

CATEGORIES = (
    "Diagnostic Dilemmas",
    "Unexpected Drug Interactions",
    "Atypical Presentations of Common Diseases",
    "Complex Pathophysiology",
)
DIFFICULTIES = ("standard", "impossible")
TRAP_SCORE = -10
DEFAULT_MIN_ANSWERS = 60

# Token expansions applied AFTER non-alphanumerics become spaces.
_TOKEN_MAP = {"dz": "disease", "synd": "syndrome", "ab": "antibody", "abs": "antibodies"}
_ARTICLES = {"the", "a", "an"}


def normalize(text) -> str:
    """Collision key for an answer name/alias (see module spec in the task brief)."""
    s = unicodedata.normalize("NFKD", str(text).lower())
    s = "".join(c for c in s if not unicodedata.combining(c))  # strip accents
    s = re.sub(r"[‘’ʼ`´]", "'", s)  # curly apostrophes -> '
    s = re.sub(r"'s\b", "", s)  # possessive: "graves's"/"hashimoto's" -> stem
    prev = None
    while prev != s:  # delete parenthetical text (handles nesting)
        prev, s = s, re.sub(r"\([^()]*\)", " ", s)
    s = re.sub(r"\bw/o\b", " without ", s)  # must run before "w/"
    s = re.sub(r"\bw/", " with ", s)
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)  # everything else -> space
    toks = [_TOKEN_MAP.get(t, t) for t in s.split()]
    if toks and toks[0] in _ARTICLES:  # drop one leading article
        toks = toks[1:]
    return " ".join(toks)


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def valid_score(v) -> bool:
    return _is_int(v) and (v == TRAP_SCORE or 1 <= v <= 100)


def validate_db(db, min_answers: int = DEFAULT_MIN_ANSWERS, warnings=None) -> list:
    """Return a list of error strings (empty = valid).

    Non-fatal notes (short aliases, unusual Board-Prep-Trap counts) are appended to
    `warnings` if a list is supplied; they never cause errors.
    """
    errs: list = []
    warns = warnings if warnings is not None else []
    if not isinstance(db, dict):
        return ["top level must be a JSON object"]

    if db.get("version") != 1:
        errs.append(f"version must be 1 (got {db.get('version')!r})")
    ga = db.get("generated_at")
    try:
        datetime.fromisoformat(str(ga).replace("Z", "+00:00"))
    except ValueError:
        errs.append(f"generated_at is not ISO-8601: {ga!r}")
    if not isinstance(db.get("generator"), str) or not db["generator"].strip():
        errs.append("generator must be a non-empty string")
    if not isinstance(db.get("review_status"), str) or not db["review_status"].strip():
        errs.append("review_status must be a non-empty string (normally 'unreviewed')")
    prompts = db.get("prompts")
    if not isinstance(prompts, list) or not prompts:
        errs.append("prompts must be a non-empty list")
        return errs

    seen_ids: dict = {}
    for pi, p in enumerate(prompts):
        if not isinstance(p, dict):
            errs.append(f"prompts[{pi}]: not an object")
            continue
        pid = p.get("id")
        tag = f"prompt {pid!r}" if isinstance(pid, str) and pid else f"prompts[{pi}]"
        if not isinstance(pid, str) or not pid.strip():
            errs.append(f"{tag}: id missing or not a string")
        elif pid in seen_ids:
            errs.append(f"{tag}: duplicate id (also prompts[{seen_ids[pid]}])")
        else:
            seen_ids[pid] = pi
        if p.get("category") not in CATEGORIES:
            errs.append(f"{tag}: bad category {p.get('category')!r}")
        if not isinstance(p.get("prompt"), str) or not p["prompt"].strip():
            errs.append(f"{tag}: prompt text missing")
        diff = p.get("difficulty")
        if diff not in DIFFICULTIES:
            errs.append(f"{tag}: difficulty must be one of {DIFFICULTIES} (got {diff!r})")
        if not isinstance(p.get("source"), str) or not p["source"].strip():
            errs.append(f"{tag}: source missing")

        answers = p.get("answers")
        if not isinstance(answers, list):
            errs.append(f"{tag}: answers must be a list")
            continue
        if len(answers) < min_answers:
            errs.append(f"{tag}: only {len(answers)} answers (< {min_answers})")

        owner: dict = {}  # normalized key -> index of the answer that owns it
        traps = 0
        for ai, a in enumerate(answers):
            if not isinstance(a, dict):
                errs.append(f"{tag} answer[{ai}]: not an object")
                continue
            name = a.get("name")
            if not isinstance(name, str) or not name.strip():
                errs.append(f"{tag} answer[{ai}]: name missing")
                continue
            al = a.get("aliases")
            if not isinstance(al, list) or not all(isinstance(x, str) for x in al):
                errs.append(f"{tag} answer {name!r}: aliases must be a list of strings")
                al = []
            sc = a.get("score")
            if not valid_score(sc):
                errs.append(f"{tag} answer {name!r}: invalid score {sc!r} (need -10 or 1..100)")
            elif sc == 100 and diff != "impossible":
                errs.append(f"{tag} answer {name!r}: score 100 only allowed on impossible prompts")
            elif sc == TRAP_SCORE:
                traps += 1
            if "pearl" in a and (not isinstance(a["pearl"], str) or not a["pearl"].strip()):
                errs.append(f"{tag} answer {name!r}: pearl must be a non-empty string if present")
            for x in al:
                if len(x.strip()) < 3:
                    warns.append(f"{tag} answer {name!r}: very short alias {x!r}")

            # Cross-answer collision check on every normalized name/alias.
            for key in {normalize(s) for s in [name, *al]}:
                if not key:
                    errs.append(f"{tag} answer {name!r}: name/alias normalizes to empty")
                elif key in owner and owner[key] != ai:
                    other = answers[owner[key]].get("name")
                    errs.append(f"{tag}: answers {other!r} and {name!r} share normalized key {key!r}")
                else:
                    owner[key] = ai
        if answers and not 2 <= traps <= 4:
            warns.append(f"{tag}: {traps} Board Prep Trap (-10) answers (expected 2-4)")
    return errs


def main(argv=None) -> int:
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Validate a Project Zebra prompt DB JSON file.")
    ap.add_argument("path")
    ap.add_argument("--min-answers", type=int, default=DEFAULT_MIN_ANSWERS)
    args = ap.parse_args(argv)
    try:
        db = json.loads(Path(args.path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"ERROR: cannot read {args.path}: {e}", file=sys.stderr)
        return 1
    warns: list = []
    errs = validate_db(db, args.min_answers, warns)
    for w in warns:
        print(f"WARN: {w}", file=sys.stderr)
    for e in errs:
        print(f"ERROR: {e}", file=sys.stderr)
    n = len(db.get("prompts", [])) if isinstance(db, dict) and isinstance(db.get("prompts"), list) else 0
    print(f"{args.path}: {n} prompts, {len(errs)} errors, {len(warns)} warnings")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
