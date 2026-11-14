#!/usr/bin/env python3
"""Project Zebra data pipeline: ABIM outlines / MKSAP-style text -> validated prompt DB.

Standard library only.  Run with:  uv run --no-project tools/mksap_abim_parser.py --input DIR_OR_FILE ...

Stages
  1. Chunk the input text; ask an LLM for BROAD prompts in 4 categories.
  2. For each prompt, ask for N valid answers (aliases, rarity score, optional pearl).
  3. Sanitize / dedupe / repair (re-ask excluding existing answers, max 2 rounds if
     under --min-answers), validate with validate_db.py, write JSON atomically.

Providers: anthropic (ANTHROPIC_API_KEY) and openrouter (OPENROUTER_API_KEY).
API keys are read from the environment only; they are never printed or logged, and
--dry-run prints request bodies only (never headers).  --mock uses a deterministic fake
LLM (generator "mock") and refuses to write to the real DB path.

COPYRIGHT / SAFETY NOTES
  * Real MKSAP text is copyrighted by the American College of Physicians (ACP).  It must be
    licensed to you and used LOCALLY only; do not commit it or redistribute it.  The prompts
    to the LLM ask for topic inspiration only (no copying of source wording).
  * ALL LLM-generated clinical content and rarity scores are unverified.  Every answer, alias,
    pearl and score needs physician review before use (db "review_status" starts "unreviewed").
"""
import argparse
import hashlib
import json
import os
import random
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # so `import validate_db` always works
from validate_db import CATEGORIES, DEFAULT_MIN_ANSWERS, TRAP_SCORE, normalize, valid_score, validate_db  # noqa: E402

TOOLS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_DIR.parent
DEFAULT_OUT = REPO_ROOT / "data" / "clinical_prompts_db.json"
DEFAULT_MOCK_OUT = REPO_ROOT / "data" / "mock_db.json"
DEFAULT_INPUT = TOOLS_DIR / "sample_input"

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODELS = {"anthropic": "claude-sonnet-5-5", "openrouter": "anthropic/claude-sonnet-5.5"}
MAX_ATTEMPTS = 5
CAT_ABBR = dict(zip(CATEGORIES, ("dd", "di", "ap", "cp")))


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- prompts
RUBRIC = """SCORING RUBRIC (score = how rarely a TRAINED Internal Medicine resident would name this answer):
  1-15    Med Student: knee-jerk textbook answers everyone names first.
  -10     Board Prep Trap: a VALID answer that is a famous boards-memorized zebra, so it is statistically
          common despite sounding exotic. Use EXACTLY the value -10. Include 2-4 per prompt.
  16-35   Intern: named by a sharp intern.
  36-55   Senior Resident: named by a strong senior resident after some thought.
  56-79   Fellow: named by a subspecialty fellow.
  80-99   Attending: obscure but literature-validated.
  100     Dr. Bazo (the rarest): ONLY on prompts whose difficulty is "impossible" - ultra-rare genetic or
          paraneoplastic items. Never use 100 on a "standard" prompt.
Use the whole range (many answers at every level); never use 0 or any other negative number."""

RULES = """RULES FOR ANSWERS:
  - Omit any answer you are not confident is genuinely valid for the prompt. Quality over quantity.
  - No two answers may be the same entity. Put abbreviations, eponyms, brand names and alternate
    spellings in that answer's "aliases" - never as a separate answer.
  - "pearl" is OPTIONAL: one factual sentence that explains why the answer is valid. No invented
    statistics, percentages, dates or citations; leave it out if unsure.
  - Answer format: {"name": str, "aliases": [str], "score": int, "pearl": str (optional)}"""

SYSTEM = ("You are an expert Internal Medicine educator building a rare-answer trivia game for "
          "IM residents. Reply with ONE JSON object only: no prose, no markdown.")


def stage1_user(chunk: str, n: int, n_impossible: int) -> str:
    cats = "\n".join(f'  - "{c}"' for c in CATEGORIES)
    return f"""SOURCE MATERIAL (an ABIM blueprint outline and/or board-style question text). Use it only as
topic inspiration. Do not copy its wording and do not reproduce vignettes or answer choices.
<<<
{chunk}
>>>

Write {n} BROAD, self-contained trivia prompts inspired by these topics. Each prompt asks a player to
name members of a LARGE set (60+ distinct valid answers exist), e.g. "Name causes of a high anion gap
metabolic acidosis". No patient vignettes, no single-answer questions, no patient identifiers.
Category must be one of these exact strings (spread across them where the material allows):
{cats}
Exactly {n_impossible} of the {n} prompts must have difficulty "impossible" (broad sets that include
ultra-rare genetic or paraneoplastic members); all others are "standard".
Return: {{"prompts": [{{"category": str, "prompt": str, "difficulty": "standard"|"impossible"}}]}}"""


def stage2_user(p: dict, n: int) -> str:
    imp = ('This prompt is "impossible": include several ultra-rare genetic/paraneoplastic items scored 100.'
           if p["difficulty"] == "impossible" else 'This prompt is "standard": never use score 100.')
    return f"""{RUBRIC}

{RULES}

PROMPT: {p['prompt']}
CATEGORY: {p['category']}
DIFFICULTY: {p['difficulty']}. {imp}

Give {n} distinct valid answers spanning every score band (including 2-4 answers scored -10).
Return: {{"answers": [ ... ]}}"""


def repair_user(p: dict, need: int, existing: list) -> str:
    traps = sum(1 for a in existing if a["score"] == TRAP_SCORE)
    names = "; ".join(a["name"] for a in existing)
    imp = ('Difficulty "impossible": score 100 allowed for ultra-rare items.'
           if p["difficulty"] == "impossible" else 'Difficulty "standard": never use score 100.')
    return f"""{RUBRIC}

{RULES}

PROMPT: {p['prompt']}
CATEGORY: {p['category']}. {imp}

These answers already exist (do NOT repeat them or their aliases): {names}

Give {need} MORE distinct valid answers not in that list. There are already {traps} answers scored -10;
add -10 answers only if that count is below 4. Omit anything you are not confident is valid.
Return: {{"answers": [ ... ]}}"""


# --------------------------------------------------------------------------- JSON extraction
def extract_json(text: str):
    """Pull the first JSON object/array out of an LLM reply (code fences, chatter, etc.)."""
    dec = json.JSONDecoder()
    cands = re.findall(r"```(?:json|JSON)?\s*(.*?)```", text, flags=re.S) + [text]
    for blob in cands:
        for m in re.finditer(r"[\[{]", blob):
            try:
                val, _ = dec.raw_decode(blob[m.start():])
            except ValueError:
                continue
            if isinstance(val, (dict, list)):
                return val
    return None


def salvage_list(text: str, key: str) -> list:
    """Recover complete objects from a truncated '"key": [ {...}, {...' reply."""
    m = re.search(rf'"{key}"\s*:\s*\[', text)
    if not m:
        return []
    dec, pos, out = json.JSONDecoder(), m.end(), []
    while True:
        nxt = re.compile(r"\s*,?\s*").match(text, pos)
        pos = nxt.end()
        if pos >= len(text) or text[pos] != "{":
            return out
        try:
            val, pos = dec.raw_decode(text, pos)
        except ValueError:
            return out
        out.append(val)


def ask_list(client, user: str, key: str, max_tokens: int, task: dict) -> list:
    """Call the LLM and return reply[key] as a list; one retry on unparsable output."""
    for attempt in (1, 2):
        text = client.complete(SYSTEM, user, max_tokens, task)
        val = extract_json(text)
        if isinstance(val, dict) and isinstance(val.get(key), list):
            return val[key]
        if isinstance(val, list):
            return val
        got = salvage_list(text, key)
        if got:
            log(f"  (salvaged {len(got)} items from a truncated/invalid reply)")
            return got
        log(f"  unparsable reply (attempt {attempt}/2)")
    raise LLMError(f"no usable JSON '{key}' list after 2 attempts")


# --------------------------------------------------------------------------- LLM clients
class LLMError(Exception):
    def __init__(self, msg, fatal=False):
        super().__init__(msg)
        self.fatal = fatal


class ApiClient:
    """Anthropic Messages API or OpenRouter chat-completions via urllib (stdlib)."""

    def __init__(self, provider, model, key):
        self.provider, self.model, self._key = provider, model, key
        self.generator = f"{provider}:{model}"

    def build_request(self, system, user, max_tokens, with_key=True):
        """Return (url, headers, body).  Headers carry the key and are NEVER printed."""
        k = self._key if with_key else "<redacted>"
        ua = {"User-Agent": "project-zebra-pipeline/1.0", "Content-Type": "application/json"}
        if self.provider == "anthropic":
            body = {"model": self.model, "max_tokens": max_tokens, "system": system,
                    "messages": [{"role": "user", "content": user}]}
            return ANTHROPIC_URL, {**ua, "x-api-key": k, "anthropic-version": "2023-06-01"}, body
        body = {"model": self.model, "max_tokens": max_tokens,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        return OPENROUTER_URL, {**ua, "Authorization": f"Bearer {k}"}, body

    def complete(self, system, user, max_tokens, task=None):
        url, headers, body = self.build_request(system, user, max_tokens)
        reply = self._post(url, headers, json.dumps(body).encode("utf-8"))
        try:
            if self.provider == "anthropic":
                if reply.get("stop_reason") == "max_tokens":
                    log("  warning: reply hit max_tokens (may be truncated)")
                return "".join(b.get("text", "") for b in reply["content"] if b.get("type") == "text")
            return reply["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            raise LLMError(f"unexpected response shape from {self.provider}") from None

    def _post(self, url, headers, data):
        """POST with retry/backoff on 429, 408, 5xx and network errors."""
        for attempt in range(1, MAX_ATTEMPTS + 1):
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            delay = min(60, 2 ** attempt) + random.random()
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                detail = e.read(600).decode("utf-8", "replace").replace(self._key or "\0", "***")
                retry = e.code in (408, 429) or e.code >= 500
                if not retry or attempt == MAX_ATTEMPTS:
                    raise LLMError(f"HTTP {e.code} from {self.provider}: {detail}", fatal=not retry) from None
                ra = e.headers.get("Retry-After", "")
                delay = max(delay, float(ra)) if ra.replace(".", "", 1).isdigit() else delay
                log(f"  HTTP {e.code}; retry {attempt}/{MAX_ATTEMPTS - 1} in {delay:.0f}s")
            except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as e:
                if attempt == MAX_ATTEMPTS:
                    raise LLMError(f"network/parse error: {type(e).__name__}") from None
                log(f"  {type(e).__name__}; retry {attempt}/{MAX_ATTEMPTS - 1} in {delay:.0f}s")
            time.sleep(delay)


class MockClient:
    """Deterministic fake LLM for offline testing.  Output is NOT medical content."""

    provider, model, generator = "mock", "mock", "mock"

    def complete(self, system, user, max_tokens, task=None):
        if task["stage"] == 1:
            return self._stage1(task)
        return self._answers(task)

    @staticmethod
    def _stage1(t):
        lines = [l.strip(" -*#\t") for l in t["chunk"].splitlines() if len(l.strip()) > 12]
        rows = []
        for i in range(t["n"]):
            topic = " ".join(re.findall(r"[A-Za-z]+", lines[(i * 5 + t["chunk_index"]) % len(lines)])[:6])
            cat = CATEGORIES[(i + t["chunk_index"]) % 4]
            hard = i >= t["n"] - t["n_impossible"]
            rows.append({"category": cat, "prompt": f"[MOCK] Name {cat.lower()} items related to: {topic}",
                         "difficulty": "impossible" if hard else "standard"})
        # Alternate fenced / chatty replies so the extractor is exercised.
        return "Here you go:\n```json\n" + json.dumps({"prompts": rows}) + "\n```" if t["chunk_index"] % 2 \
            else json.dumps({"prompts": rows})

    @staticmethod
    def _answers(t):
        p, tag = t["prompt"], hashlib.sha1(t["prompt"]["prompt"].encode()).hexdigest()[:4]
        repair = t["stage"] == 3
        skip = {normalize(x) for x in t.get("exclude", [])}
        if repair:  # fresh numbering that cannot collide with initial 1..N
            ks = [k for k in range(100 * t["round"], 100 * t["round"] + 3 * t["n"])
                  if normalize(f"Mock answer {tag} {k:03d}") not in skip][: t["n"]]
        else:  # deliberately short by 8 so repair is exercised when --answers is near --min-answers
            ks = list(range(1, max(t["n"] - 8, 1) + 1))
        out = []
        for k in ks:
            if k < 100 and k in (3, 17, 31):
                s = TRAP_SCORE
            elif p["difficulty"] == "impossible" and k % 10 == 0 and k < 100:
                s = 100
            else:
                s = [1 + (k * 3) % 15, 16 + (k * 7) % 64, 80 + k % 20, 16 + (k * 5) % 64][k % 4]
            a = {"name": f"Mock answer {tag} {k:03d}", "aliases": [f"MK{tag}{k}"], "score": s}
            if k % 3 == 0:
                a["pearl"] = f"Mock pearl for item {k}; not clinical content."
            out.append(a)
        if not repair and len(out) > 6:
            out[5]["aliases"].append(out[4]["name"])  # alias collision -> sanitizer drops it
            out.append({**out[1], "name": out[1]["name"].upper(), "aliases": []})  # duplicate -> dropped
            out.append({"name": "Bad score item", "aliases": [], "score": 0})  # invalid -> dropped
        return json.dumps({"answers": out})


# --------------------------------------------------------------------------- input / chunking
def load_chunks(inputs, max_chars):
    """Yield dicts {source, index, text} from .txt/.md files (or directories of them)."""
    files = []
    for raw in inputs:
        p = Path(raw)
        files += sorted(q for q in p.rglob("*") if q.suffix.lower() in (".txt", ".md")) if p.is_dir() else [p]
    chunks = []
    for f in files:
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            log(f"skip {f}: {e}")
            continue
        buf, n = "", 0
        for para in re.split(r"\n\s*\n", text):
            para = para.strip()
            while len(para) > max_chars:  # hard-split a giant paragraph
                para, rest = para[:max_chars], para[max_chars:]
                chunks.append({"source": f"{f.name}#{n + 1}", "text": para})
                n, para = n + 1, rest
            if buf and len(buf) + len(para) + 2 > max_chars:
                chunks.append({"source": f"{f.name}#{n + 1}", "text": buf})
                n, buf = n + 1, ""
            buf = f"{buf}\n\n{para}" if buf else para
        if buf.strip():
            chunks.append({"source": f"{f.name}#{n + 1}", "text": buf})
    for i, c in enumerate(chunks):
        c["index"] = i
    return chunks


# --------------------------------------------------------------------------- stage 1
def run_stage1(client, chunks, args):
    prompts, seen = [], set()
    n_imp = round(args.difficulty_mix * args.prompts_per_chunk)
    for c in chunks:
        if len(prompts) >= args.max_prompts:
            break
        log(f"[stage 1] {c['source']}")
        task = {"stage": 1, "chunk": c["text"], "chunk_index": c["index"],
                "n": args.prompts_per_chunk, "n_impossible": n_imp}
        try:
            rows = ask_list(client, stage1_user(c["text"], args.prompts_per_chunk, n_imp), "prompts", 3000, task)
        except LLMError as e:
            if e.fatal:
                raise
            log(f"  skipped chunk: {e}")
            continue
        for r in rows:
            if not isinstance(r, dict) or r.get("category") not in CATEGORIES:
                continue
            text, key = str(r.get("prompt", "")).strip(), normalize(r.get("prompt", ""))
            if not text or key in seen:
                continue
            seen.add(key)
            diff = "impossible" if r.get("difficulty") == "impossible" else "standard"
            pid = f"{CAT_ABBR[r['category']]}-{hashlib.sha1(key.encode()).hexdigest()[:8]}"
            prompts.append({"id": pid, "category": r["category"], "prompt": text, "difficulty": diff,
                            "source": c["source"], "answers": []})
    return prompts[: args.max_prompts]


# --------------------------------------------------------------------------- stage 2/3
def clean_answers(raw, difficulty, existing=()):
    """Sanitize LLM answers and dedupe them against `existing` and each other.

    Drops invalid/duplicate answers, drops colliding aliases, caps stray 100s on standard prompts to 99.
    Returns only the NEW clean answers (caller appends them).
    """
    taken = {k for a in existing for k in [normalize(a["name"]), *map(normalize, a["aliases"])]}
    out = []
    for a in raw if isinstance(raw, list) else []:
        if not isinstance(a, dict) or not isinstance(a.get("name"), str):
            continue
        name = a["name"].strip()
        s = a.get("score")
        s = int(s) if isinstance(s, float) and s.is_integer() else s
        s = int(s) if isinstance(s, str) and re.fullmatch(r"-?\d+", s.strip()) else s
        if s == 100 and difficulty != "impossible":
            s = 99
        if not name or not normalize(name) or normalize(name) in taken or not valid_score(s):
            continue
        keys, aliases = {normalize(name)}, []
        for al in a.get("aliases") if isinstance(a.get("aliases"), list) else []:
            if isinstance(al, str) and al.strip() and normalize(al) and normalize(al) not in taken | keys:
                keys.add(normalize(al))
                aliases.append(al.strip())
        clean = {"name": name, "aliases": aliases, "score": s}
        pearl = a.get("pearl")
        if isinstance(pearl, str) and 0 < len(pearl.strip()) <= 400:
            clean["pearl"] = pearl.strip()
        taken |= keys
        out.append(clean)
    return out


def fill_prompt(client, p, args):
    """Stage 2 (initial answers) + stage 3 (clean, then up to 2 repair rounds). Returns True if usable."""
    budget = lambda n: min(16000, max(4096, n * 120))  # noqa: E731
    raw = ask_list(client, stage2_user(p, args.answers), "answers", budget(args.answers),
                   {"stage": 2, "prompt": p, "n": args.answers})
    p["answers"] = clean_answers(raw, p["difficulty"])
    for rnd in (1, 2):
        need = args.min_answers - len(p["answers"])
        if need <= 0:
            break
        ask = need + 10  # over-ask: some will be dupes or dropped
        log(f"  repair round {rnd}: {len(p['answers'])} answers, need {need} more")
        names = [a["name"] for a in p["answers"]]
        raw = ask_list(client, repair_user(p, ask, p["answers"]), "answers", budget(ask),
                       {"stage": 3, "round": rnd, "prompt": p, "n": ask, "exclude": names})
        p["answers"] += clean_answers(raw, p["difficulty"], p["answers"])
    return len(p["answers"]) >= args.min_answers


def write_atomic(path: Path, db):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


# --------------------------------------------------------------------------- main
def dry_run(client, chunks, args):
    """Print the request payloads (no network, keys redacted/never read)."""
    def show(label, system, user, mt):
        url, _headers, body = client.build_request(system, user, mt, with_key=False)
        print(f"\n===== {label} =====\nPOST {url}  (headers omitted; API key never printed)")
        print(json.dumps(body, indent=2, ensure_ascii=False))
    n_imp = round(args.difficulty_mix * args.prompts_per_chunk)
    ph = {"prompt": "<prompt produced by stage 1>", "category": CATEGORIES[0], "difficulty": "impossible"}
    print(f"[dry-run] provider={args.provider} model={client.model} chunks={len(chunks)} "
          f"(stage 1: {len(chunks)} calls; stage 2: ~{len(chunks) * args.prompts_per_chunk} calls; "
          f"stage 3 repair: up to 2 per prompt)")
    if chunks:
        show(f"STAGE 1 (chunk 1/{len(chunks)}: {chunks[0]['source']})", SYSTEM,
             stage1_user(chunks[0]["text"], args.prompts_per_chunk, n_imp), 3000)
    show("STAGE 2 (answers for a placeholder prompt)", SYSTEM, stage2_user(ph, args.answers), 8400)
    ex = [{"name": "Example answer", "aliases": [], "score": TRAP_SCORE}]
    show("STAGE 3 (repair round, placeholder)", SYSTEM, repair_user(ph, 12, ex), 4096)


def parse_args(argv):
    ap = argparse.ArgumentParser(description="ABIM/MKSAP text -> validated Project Zebra prompt DB (LLM-assisted).")
    ap.add_argument("--input", nargs="+", default=[str(DEFAULT_INPUT)], help="files/dirs of .txt/.md (default: tools/sample_input)")
    ap.add_argument("--out", help=f"output JSON (default {DEFAULT_OUT.relative_to(REPO_ROOT)}; --mock: data/mock_db.json)")
    ap.add_argument("--provider", choices=["anthropic", "openrouter"], default="anthropic")
    ap.add_argument("--model", help="model id (or env ZEBRA_MODEL). Defaults: anthropic claude-sonnet-5-5; openrouter anthropic/claude-sonnet-5.5 (verify slug)")
    ap.add_argument("--prompts-per-chunk", type=int, default=3)
    ap.add_argument("--answers", type=int, default=70, help="answers requested per prompt (default 70)")
    ap.add_argument("--min-answers", type=int, default=DEFAULT_MIN_ANSWERS)
    ap.add_argument("--difficulty-mix", type=float, default=0.2, help="fraction of prompts flagged impossible (default 0.2)")
    ap.add_argument("--chunk-chars", type=int, default=6000)
    ap.add_argument("--max-prompts", type=int, default=1000, help="cap total prompts (cost control)")
    ap.add_argument("--dry-run", action="store_true", help="print request payloads; no network, no keys, no writes")
    ap.add_argument("--mock", action="store_true", help="deterministic fake LLM (offline test; generator 'mock')")
    a = ap.parse_args(argv)
    if not 0 <= a.difficulty_mix <= 1:
        ap.error("--difficulty-mix must be in [0,1]")
    if a.mock and a.dry_run:
        ap.error("--mock and --dry-run are mutually exclusive")
    if a.answers < a.min_answers:
        ap.error("--answers must be >= --min-answers")
    return a


def main(argv=None) -> int:
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8", errors="replace")
    args = parse_args(argv)
    chunks = load_chunks(args.input, args.chunk_chars)
    if not chunks:
        log("no .txt/.md input found")
        return 2

    if args.mock:
        client, out = MockClient(), Path(args.out or DEFAULT_MOCK_OUT)
        if out.resolve() == DEFAULT_OUT.resolve() or out.name == DEFAULT_OUT.name:
            log("refusing: --mock output may not target the real DB path/name (clinical_prompts_db.json)")
            return 2
    else:
        out = Path(args.out or DEFAULT_OUT)
        model = args.model or os.environ.get("ZEBRA_MODEL") or DEFAULT_MODELS[args.provider]
        if args.provider == "openrouter" and model == DEFAULT_MODELS["openrouter"]:
            log(f"note: using default OpenRouter slug {model!r} - verify slug at openrouter.ai/models "
                "(or pass --model / ZEBRA_MODEL)")
        keyvar = "ANTHROPIC_API_KEY" if args.provider == "anthropic" else "OPENROUTER_API_KEY"
        key = None if args.dry_run else os.environ.get(keyvar)
        if not args.dry_run and not key:
            log(f"error: environment variable {keyvar} is not set")
            return 2
        client = ApiClient(args.provider, model, key)

    if args.dry_run:
        dry_run(client, chunks, args)
        return 0

    try:
        prompts = run_stage1(client, chunks, args)
        log(f"stage 1 produced {len(prompts)} prompts from {len(chunks)} chunks")
        kept = []
        for i, p in enumerate(prompts, 1):
            log(f"[stage 2/3] {i}/{len(prompts)} {p['id']} ({p['difficulty']}): {p['prompt'][:70]}")
            try:
                if fill_prompt(client, p, args):
                    kept.append(p)
                else:
                    log(f"  dropped {p['id']}: only {len(p['answers'])} valid answers after repair")
            except LLMError as e:
                if e.fatal:
                    raise
                log(f"  dropped {p['id']}: {e}")
    except LLMError as e:
        log(f"fatal API error: {e}")
        return 1

    db = {"version": 1, "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
          "generator": client.generator, "review_status": "unreviewed", "prompts": kept}
    warns: list = []
    errs = validate_db(db, args.min_answers, warns)
    for w in warns:
        log(f"WARN: {w}")
    if errs:
        for e in errs:
            log(f"ERROR: {e}")
        log("validation failed; nothing written")
        return 1
    write_atomic(out, db)
    log(f"wrote {out}: {len(kept)}/{len(prompts)} prompts, generator={db['generator']} (needs physician review)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
