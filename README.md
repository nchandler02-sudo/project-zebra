> **Treat this as unverified.** The software is tested; the medicine is not. Every diagnosis, answer, rarity score, teaching point and question in `data/` was drafted by AI and has **not** been reviewed by a physician. Use it for practice and conversation, never for clinical decisions, and check anything you plan to teach. Details in [DISCLAIMER.md](DISCLAIMER.md). Corrections from clinicians are welcome. Licensed MIT.

# Project Zebra

A rare-answer medical trivia game for Internal Medicine residents, played live in morning report or Thursday conference.
The big screen shows a broad clinical prompt ("Name causes of fever of unknown origin"); residents scan a QR code, type
answers on their phones, and score by how *rare* (but valid) their answers are. Common answers earn almost nothing, famous
board-prep zebras are penalised, and "Impossible" rounds flip the whole UI to crimson.

It is a plain web app: one small Node server, no database, no accounts, nothing to install on phones.

## Run it

```bash
npm install
npm start              # http://localhost:3000/host   (PORT=4000 npm start to change)
```

1. Open `/host` on the projector machine. It shows a 4-letter room code and a QR code.
2. Residents scan the QR (or open the printed URL) on the same Wi-Fi, enter a nickname, and wait.
3. Host keys: `Space` start / next round, `E` end round early, `I` next round is Impossible tier, `F` fullscreen.
   Also `M` host menu (or click **Menu**), `Q` big join QR code for latecomers, `L` Lightning round on/off, `D` difficulty,
   `R` restart game (reset scores; keep players or remove everyone), `B` debug panel (connection, server, room, players, event log, Copy JSON),
   `A` on the reveal screen shows the full answer list with each answer's points and how many players named it (phones get the same list under "All answers"), `U` set the address phones should use. `Esc` closes any panel. Note the debug log shows typed answers, so close it before the reveal.

The QR points at `location.origin`, so whatever address you opened `/host` on is what phones get. Open the host page via the
machine's LAN address (the server prints these) rather than `localhost`, or phones will be sent to `localhost`.
Windows Firewall will prompt the first time: allow Node on private networks.

## Scoring

| Tier | Points | Meaning |
|---|---|---|
| Med Student | 1-15 | knee-jerk textbook answers |
| Board Prep Trap | -10 | famous boards zebras everyone memorises |
| Intern | 16-35 | what a sharp intern comes up with |
| Senior Resident | 36-55 | solid second-line causes |
| Fellow | 56-79 | niche, subspecialty-level answers |
| Attending | 80-99 | obscure, literature-supported |
| Dr. Bazo | 100 | the rarest answer on the list (only on Impossible-tier prompts) |

The host picks a difficulty in the lobby or between rounds (key `D`): **Casual** (default: 60 s, 5 answers, every match scores at least 10,
phones say whether an answer is on the list), **Standard** (45 s, 3 answers) or **Zebra** (45 s, 3 answers, the original rules).

**Board-prep traps** are famous answers that score -10 (526 of the bank's answers). The host controls them separately with the **Traps** toggle (key `X`, lobby or between rounds, any difficulty):
**Off** (default, a trap scores 0), **When common** (costs 10 only if at least 30% of the players who answered named it) or **Always** (costs 10). `ZEBRA_ROUND_SECONDS` overrides the round length. Points stay hidden until the
round ends, and the reveal teaches the most attainable misses first plus one zebra. The "Diagnostic Depth" meter shows the best rarity found so far without saying who or what.

## Lightning round (optional add-on)

Turn it on with `L` (lobby or between rounds). When the normal round timer ends, the phones stop taking typed answers and
show a series of 4-choice questions for 30 more seconds (the normal timer length is unchanged). `E` skips straight to the questions. Right earns points, wrong costs points, skipped costs nothing (Casual +15 / -5,
Standard +20 / -10, Zebra +25 / -15). Points count at the reveal, where each player sees their questions with the explanations and
the big screen shows the room's score and the most-missed question. Questions live in `data/mc_questions.json` (51, AI-written and
unreviewed like everything else; each can be tagged with prompt ids so topic-related questions come first). `ZEBRA_MC_SECONDS`
changes the window length.

## Rock paper scissors tournament (break game)

Press `T` (lobby or between rounds, 2+ players) to start an on-demand tournament for everyone connected. Players are paired at random
each round (an odd player faces Dr. Bot) and have 15 seconds to throw, or less if both lock in sooner. Ties are re-thrown, and a player
who does not throw in time forfeits the match. Losing a match costs a life; at zero lives you are out. Small and medium rooms get extra
lives (2 to 4, shown as hearts) so it always runs at least 4 rounds; rooms of 16+ are plain single elimination, which is already 4+ rounds.
It repeats until one champion is left, who gets +30 on the leaderboard (+15 for the runner-up). `E` twice ends it early; `Space` goes back
to the game once a champion is crowned. Throws stay hidden until the reveal.

## Question bank page

`/bank?key=<key>` (and `/bank.json?key=<key>`) shows every prompt, answer, score, level, alias and pearl, plus the lightning questions. It lists all the answers, so it is protected by a key:
`ZEBRA_BANK_KEY` if set, otherwise a random key saved in `data/.bank_key` (git-ignored) and printed when the server starts. Do not give the link to players.

## Layout

```
server/index.js      HTTP + WebSocket server (one port)
server/game.js       rooms, rounds, timer, grading, reveal
server/matcher.js    answer normalisation + fuzzy matching (Damerau-Levenshtein, threshold 0.82)
public/host.html     big-screen client          public/index.html   phone client
data/clinical_prompts_db.json   question bank: 174 prompts (144 easy, 30 hard including 4 impossible, all unreviewed); see "Content review"
data/mc_questions.json          Lightning round multiple-choice bank (51 questions, unreviewed)
server/tournament.js            rock paper scissors tournament engine
tools/mksap_abim_parser.py      LLM pipeline: ABIM outline / MKSAP-style text -> prompts + 60+ scored answers
tools/validate_db.py            schema + alias-collision validator
tests/               npm test  (matcher suite against the real DB + end-to-end WebSocket protocol test)
docs/PROTOCOL.md     wire protocol
```

## Matching

Typed text is lower-cased, accent-stripped, de-possessived ("Addison's" = "Addison"), stripped of punctuation and
parentheticals, and common abbreviations are expanded. Then: exact name/alias, word-order-insensitive, ignoring a trailing
"disease/syndrome/...", and finally fuzzy match at similarity >= 0.82. Guards: digits must agree (anti-Ma1 is not anti-Ma2),
single-letter tokens only fuzz to keyboard-adjacent letters (GABA-A is not GABA-B), and if two different answers are equally
close the player is asked to be more specific instead of being guessed at. Known limit: very close real names that are *not*
both in a prompt's list (e.g. omeprazole / esomeprazole) can fuzzy-match each other.

## Generating more questions

```bash
uv run --no-project tools/mksap_abim_parser.py --input path/to/outline.txt --out data/new_db.json   # needs ANTHROPIC_API_KEY or OPENROUTER_API_KEY
uv run --no-project tools/mksap_abim_parser.py --mock --out data/mock_db.json                       # offline pipeline check, placeholder content
uv run --no-project tools/validate_db.py data/new_db.json --min-answers 40
```

## Content review (important)

All clinical content and every rarity score in `data/clinical_prompts_db.json` was written by an AI model and is
**unreviewed**. Scores are estimates of how rarely a trained resident would name an answer, not measured data. Several
entries are case-report level evidence. Have a faculty member review before relying on it for teaching. MKSAP text is
ACP-copyrighted: use only content you are licensed to use, locally. See DISCLAIMER.md.

## Security notes

Rooms live in memory only. Anyone who can reach the server can join a room with its code; the host controls need the
room's host key (held by the host page). Messages are size- and rate-limited, names/answers are rendered as text only, and
only files in `public/` are served. If you expose the server to the internet, treat it as a classroom toy, not a secured service.

## Prompt levels

Prompts may carry `"level": "easy"`. Casual rooms draw only easy prompts (if any exist), Zebra rooms skip them, Standard mixes both. The 144 easy prompts are live but **not yet faculty-reviewed**: review the items on the `/bank` page, apply fixes to `data/clinical_prompts_db.json`, and set `review_status` once signed off.

## Games and activities (host menu, key G)
Plug-in game modes live in `server/activities/<type>.js` (server) and `public/activities/<type>.js` (projector + phone UI); the contract is in `server/activities/README.md`.
Built-in: Confidence Bets (`confidence`), Connections: Differentials (`connections`, data/connections_puzzles.json), Debrief Round (`debrief`, data/debrief_prompts.json),
Clue Ladder (`clueladder`, data/clue_cases.json), Confidence Ladder / Millionaire (`ladder`) and Medical Chopped (`chopped`, data/chopped_cases.json).
All content is AI-drafted and marked unreviewed; each item carries `review_notes`. Multiple-choice questions come from data/mc_questions.json plus every data/mc_extra*.json (merged at start; `level` 1-10 drives the Ladder).
The lightning round draws 40 random questions per round from the whole bank and gives every phone its own order, preferring questions that phone has not seen yet.

## Capacity
One room holds up to 600 players (MAX_PLAYERS_PER_ROOM), 1200 sockets per server. Broadcasts are batched (80 ms + 1 ms per player, max 600 ms) so a room answering at once stays cheap.
Load test: `node tools/loadtest.js ws://localhost:3000/ws 500` (join storm, a round with lightning, a Confidence Bets game). On a dev PC, 600 simulated phones joined in 3.4 s, screens reached everyone in under 0.6 s, server used about 100 MB and about 7% of one CPU core.
Cloud Run must be deployed with `--concurrency 1000` (each websocket counts as one request) and a single instance (rooms live in memory).

## Answer matching
server/matcher.js also accepts common clinical acronyms (built-in dictionary plus initialisms of each answer, resolved against the prompt's own list), British/Latin spellings and one-typo-per-word misspellings. Opposites (hyper/hypo) and look-alike pairs (nephritic/nephrotic, arteritis/arthritis) are never matched to each other.
