# Project Zebra wire protocol

One Node server serves static files and a WebSocket at `/ws` (same origin; use `wss://` when `location.protocol === "https:"`).
All messages are JSON text frames, each at most 2 KB. Unknown fields are ignored. The server is authoritative: it holds the
question database, grades answers, runs the 45 s timer. Answers and scoring are never sent to phones until the round ends.

Pages: `/` = phone client (`public/index.html`), `/host` = big-screen client (`public/host.html`).
Vendored QR library: `/vendor/qrcode.js` (global `qrcode`, kazuhikoarase qrcode-generator, MIT).
Shared styling may live in `public/zebra.css` (optional; each page must still work alone). No external network resources
(no CDN, no web fonts): the room Wi-Fi may have no internet. Use system fonts.

## Tiers
`tier` keys and labels (server sends both on every graded answer):
`student` "Med Student" (1-15), `intern` "Intern" (16-35), `senior` "Senior Resident" (36-55), `fellow` "Fellow" (56-79),
`attending` "Attending" (80-99), `bazo` "Dr. Bazo" (100, the rarest), `trap` "Board Prep Trap" (-10), `none` "No match" (0 points).

## Host -> server
- `{t:"host_create"}` -> server replies `hosted`.
- `{t:"host_resume", code, hostKey}` -> reply `hosted` (same room) or `error` {fatal:true} if unknown. Host page keeps `{code, hostKey}` in sessionStorage so a reload resumes the room.
- `{t:"start_round", impossible?: boolean}` valid in `lobby` and `reveal` (needs >= 1 player); `impossible:true` forces an Impossible-tier prompt.
- `{t:"end_round"}` valid in `round` (ends early -> reveal).
- `{t:"kick", pid}` removes a player.
- `{t:"set_options", difficulty?:"casual"|"standard"|"zebra", lightning?:boolean}` valid in `lobby` and `reveal`. Default is `casual`, lightning off. Turning lightning on with no question bank loaded returns a non-fatal `error`.
- `{t:"restart", kickAll?:boolean}` valid in any phase. Clears scores, round counter and used-prompt history and returns to `lobby`. With `kickAll` every player is also removed (they receive a fatal `error`).
- `{t:"start_tournament"}` valid in `lobby` and `reveal` with at least 2 connected players: phase becomes `break`. `{t:"end_tournament"}` returns to the previous phase (any time; the host UI asks twice unless a champion is crowned).
- `{t:"debug"}` -> `debug_info` (host only; players are ignored).

## Server -> host
- `{t:"hosted", code, hostKey}`; join URL for QR/text is `location.origin + "/?c=" + code`.
- `{t:"host_state", ...}` full snapshot, sent on every change and once per second during a round:
```
{ t:"host_state", code, phase:"lobby"|"round"|"reveal", roundNo, roundSeconds:45, endsInMs, maxAnswers:3,
  players:[{id, name, connected, score, answered}],          // answered = answers submitted this round (text hidden)
  leaderboard:[{id, name, score, connected}],                // sorted desc
  round: null | { category, prompt, impossible, depth },     // depth 0-100 = best matched score so far this round ("Diagnostic Depth")
  reveal: null | { players:[{id,name,roundPoints,answers:[{text,matched,answer,points,tier,tierLabel}]}],
                   topMissed:[{answer,points,tier,tierLabel,pearl}],  // best unfound answers, up to 5, no traps
                   found, total, bestFind:null|{name,answer,points,tier} } }
```
- `{t:"error", message, fatal?}`
- `host_state` also carries `lightning: {on, available, active, windowSeconds, pointsRight, pointsWrong, answered}` (`answered` = lightning answers in so far) and `players[].mcDone`. `reveal.lightning` is `null` or `{right, wrong, top:[{name,points,right,wrong}], questions:[{q,correct,why,right,wrong}]}` (most missed first, up to 3).
- `{t:"debug_info", serverTime, uptimeSec, node, rssMB, rooms, sockets, prompts, easyPrompts, mcQuestions, room:{code, phase, roundNo, difficulty, lightning, mcActive, mcPool, promptId, promptAnswers, found, depth, endsInMs, hostConnected, ageSec, players:[{id,name,connected,score,answers,matched,mcRight,mcWrong}], log:[{at,msg}]}}`. Never contains the host key or player tokens. The log includes typed answers, so the debug panel is for the host only.

## Player -> server
- `{t:"join", code, name, token?}`; `token` (from `welcome`, kept in localStorage) resumes the same player after reload/drop.
- `{t:"answer", text}` (<= 80 chars; max 3 distinct answers per round). Refused with an error ack while lightning questions are live.
- `{t:"mc_answer", qid, choice}` `choice` is the index (0-3) of the option as the player was shown it. Only valid while the lightning window is open and `qid` is the question currently served to that player.

## Server -> player
- `{t:"welcome", pid, token, name, code}` after join (name may be adjusted to be unique / clean).
- `{t:"p_state", phase, roundNo, roundSeconds, endsInMs, round:null|{category,prompt,impossible}, answersUsed, maxAnswers, score, rank, playerCount}` on every phase change and once per second during a round. Compute your deadline as `Date.now()+endsInMs`.
- `{t:"ack", ok, text, used, max, error?, matched?, duplicate?}` reply to every `answer` (text echoed cleaned). Never reveals points. In `casual` only, `matched` says whether the answer is on the list (a miss uses no slot; `used` counts matched answers; at most 10 tries). Outside casual `matched` is absent, and the same answer typed another way returns `ok:true, duplicate:true` without using a slot.
- `p_state.lightning` is `null` unless the add-on is on, else `{on, active, windowMs, pointsRight, pointsWrong, right, wrong, done, q}`. `q` is `{id, q, options:[4 strings]}` (options shuffled per player) only while `active`; the correct answer is never sent until graded. `done` means the player has answered every question.
- `{t:"mc_ack", ok, correct?, delta?, correctIdx?, why?, right?, wrong?, error?}` reply to every `mc_answer`. Points are applied to the round total at the reveal.
- `{t:"reveal", impossible, results:[{text,matched,answer,points,tier,tierLabel}], roundPoints, score, rank, topMissed:[up to 3 same shape as host], playerCount, mc:null|{right,wrong,points,items:[{q,chosen,correct,ok,why,delta}]}}`. `roundPoints` includes lightning points.
- `{t:"error", message, fatal?}` e.g. "No such room", "Room full", "Name required". `fatal:true` means show the join form again.

Players reconnect automatically (exponential backoff, resend `join` with token). While disconnected, show a banner.

## Difficulty
| | Casual (default) | Standard | Zebra |
|---|---|---|---|
| round / answers | 60 s / 5 | 45 s / 3 | 45 s / 3 |
| match scores | at least 10 | as scored | as scored |
| Board Prep Trap (-10) | 0, labelled "no penalty" | -10 only if >= 30% of players who answered named it, else 0 | -10 |
| phone feedback | "on the list" yes/no | none | none |

## Rock paper scissors tournament (phase `break`)
`host_state.tourney` / `p_state.tourney` are `null` outside the break. Stages: `pairing` (matchups shown), `throw` (15 s, `ZEBRA_RPS_SECONDS`), `reveal`, then throw again for ties or pairing for the next round, finally `done`.
Host view: `{stage, roundNo, throwNo, endsInMs, stageMs, aliveCount, entrants, maxLives, matches:[{id, a:{id,name,bot,lives}, b:{...}, aLocked, bLocked, done, winner:'a'|'b'|null, how:'win'|'forfeit'|'coinflip'|null, ties, last:{a,b,result}|null}], champion, finalist, awards}`.
Current-throw picks are never sent to the host, only `aLocked`/`bLocked`. The player view adds `role` (alive/out/spectator/champion), `lives`, `opponent`, `myPick` (own lock-in only), `last:{mine,theirs,result}` after a reveal, and `award`.
Player -> server: `{t:"rps", pick:"rock"|"paper"|"scissors"}`, locked in once sent. A loss costs a life. Lives are 1 for 16+ players, otherwise 2 to 4, chosen so that at least 4 rounds are guaranteed (`livesFor` in `server/tournament.js`). Champion +30 and runner-up +15 go onto the leaderboard.

## Lightning round (add-on)
When on, after the normal round timer ends a 30 s lightning stage follows (`ZEBRA_MC_SECONDS` overrides) and phones switch from typing to a series of 4-choice questions from `data/mc_questions.json`. Each round draws 10 questions (ones tagged for the round's prompt first); every player works through them in their own order with their own option order. Right/wrong points follow the difficulty: Casual +15/-5, Standard +20/-10, Zebra +25/-15. Unanswered questions cost nothing. Typed answers are refused while the questions are live. During a round, `roundSeconds`/`endsInMs` describe the stage on screen: the normal timer first, then the lightning stage. `end_round` from the host skips ahead to the lightning stage if it is still coming, otherwise ends the round.

`topMissed` (Pearl Reveal) is a teaching list: up to 4 unfound answers, the most attainable first (score 5-59, preferring ones with a pearl), plus one zebra. Each carries `kind: "teach"|"zebra"`. Traps are never listed.
