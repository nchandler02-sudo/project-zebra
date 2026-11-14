# Activities (plug-in game modes)

An activity is a self-contained game mode that runs inside a room while `room.phase === 'activity'`.
Drop `server/activities/<name>.js` (server logic) and `public/activities/<name>.js` (host screen and phone UI).
Nothing else needs editing: the registry loads every file here, and `public/activities/core.js` loads the client file.

## Server contract (`server/activities/<name>.js`)

```js
class MyActivity {
  static meta = { type: 'myact', title: 'My Activity', blurb: 'One sentence for the host menu.', minPlayers: 2, options: [] };
  constructor(room, opts) { /* room: the Room. opts: object from the host menu (may be empty) */ }
  hostView()        { return { stage: 'play', ... }; }   // JSON for the projector. Must be small and JSON-safe.
  playerView(pid)   { return { stage: 'play', ... }; }   // JSON for one phone. NEVER include answers the player must not see yet.
  handle(player, d) { /* player sent {t:'act', d}. Return an object to reply to that player as {t:'act_ack', d: obj}, or nothing. Return true-ish `changed` via this.changed = true */ }
  hostCommand(cmd, d) { /* host sent {t:'act_host', cmd, d}, e.g. 'next', 'reveal', 'skip' */ }
  tick(now)         { return false; }                      // called ~4x per second. Return true if the views changed (the room then broadcasts).
  onPlayerJoin(p)   {}                                     // optional
}
module.exports = MyActivity;
```

Rules:
- After `handle` or `hostCommand` the room broadcasts automatically. In `tick`, return true to broadcast.
- Award leaderboard points with `this.room.addScore(pid, points)` (integers). Do it once, when a stage resolves.
- Players are `room.players` (Map pid -> `{id, name, connected, score}`). Only count `connected !== false` players as active.
- To push a one-off message to a player: `this.room.sendTo(pid, { t: 'act_ack', d: {...} })`.
- Data: `room.db.prompts` (rare-answer topics), `room.db.mc` (multiple-choice questions). Put new content in `data/*.json` and load it in the constructor with `fs.readFileSync` (cache at module level).
- Never trust client input: validate every field of `d` (types, ranges, string length) in `handle` and `hostCommand`.
- Finish by setting `this.finished = true` and showing a final screen. The host closes the activity with the End button.
- Timers: use absolute deadlines (`Date.now() + ms`) and send `endsInMs` in the views, never a countdown number.

## Client contract (`public/activities/<name>.js`)

```js
ZebraAct.register('myact', {
  css: '...',                                    // optional, injected once
  renderHost(root, view, ctx) { /* projector. Build into `root` */ },
  renderPhone(root, view, ctx) { /* phone. Build into `root` */ },
  onAck(d, ctx) {}                               // optional: reply from handle()
});
```

- `ctx.send(d)` (phone) sends `{t:'act', d}`. `ctx.sendHost(cmd, d)` (host) sends `{t:'act_host', cmd, d}`.
- `ctx.local` is a per-activity scratch object that survives re-renders. `ctx.firstRender` is true on the first call of a stage change (`view.stage` differs from the last call).
- The renderer is called on EVERY state broadcast (about once a second during timers). Do not rebuild the DOM when nothing changed: keep the text input and its focus. Use `ctx.local.key` to remember the last stage.
- `ctx.endsAt(view)` returns an absolute timestamp from `view.endsInMs`. Use `requestAnimationFrame` or `setInterval` for countdowns and clear it when the stage changes.
- Host screen: 1rem is about 10px on a 1920 px projector, so type is large (4rem headline is normal). Use the CSS variables `--ink`, `--muted`, `--line`, `--accent` and the `.disp` class for display type (see public/host.html).
- Phone: min tap target 48px, inputs 16px+, no horizontal scroll at 320px wide. Use the variables in public/index.html (`--ink`, `--ink-dim`, `--signal`, `--surface`, `--line`).
- Build DOM with `createElement` and `textContent` (no innerHTML with data). The server sends a strict CSP.
