'use strict';
// Rock-paper-scissors tournament (break game): engine guarantees plus an end-to-end run over real WebSockets.
process.env.ZEBRA_RPS_SECONDS = '2';
process.env.ZEBRA_RPS_REVEAL_MS = '120';
process.env.ZEBRA_RPS_PAIR_MS = '120';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createServer } = require('../server/index');
const { Tournament, livesFor, minRounds, PICKS } = require('../server/tournament');

const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_db.json'), 'utf8'));

test('lives scale with group size so a tournament always lasts at least 4 rounds', () => {
  assert.equal(livesFor(2), 4);
  assert.equal(livesFor(16), 1, 'big rooms are plain single elimination');
  for (let n = 2; n <= 200; n++) assert.ok(minRounds(n, livesFor(n)) >= 4, `n=${n} guarantees 4 rounds`);
  for (let n = 3; n <= 15; n++) assert.ok(livesFor(n) >= 2, `n=${n} gets extra lives`);
});

test('simulated tournaments: always a champion, never fewer than 4 rounds, ties re-thrown', () => {
  let ties = 0;
  for (const n of [2, 3, 5, 7, 8, 11, 13, 16, 17, 33]) {
    for (let run = 0; run < 40; run++) {
      const ent = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'P' + (i + 1) }));
      let crowned = null;
      const t = new Tournament(ent, () => true, (c) => { crowned = c; });
      let clock = Date.now(), guard = 0;
      while (t.stage !== 'done' && guard++ < 5000) {
        if (t.stage === 'throw') {
          for (const m of t.matches) { if (m.ties) ties++; for (const s of ['a', 'b']) if (!m.done && m[s].pid != null) t.pick(m[s].pid, PICKS[Math.floor(Math.random() * 3)]); }
        }
        clock += 1e6; t.tick(clock);
      }
      assert.equal(t.stage, 'done', `n=${n} finishes`);
      assert.ok(crowned != null && t.alive.length === 1, `n=${n} crowns exactly one champion`);
      assert.ok(t.roundNo >= 4, `n=${n} lasted ${t.roundNo} rounds`);
    }
  }
  assert.ok(ties > 0, 'ties happen and are replayed');
});

test('an odd player faces Dr. Bot, and the bot role rotates', () => {
  const ent = [1, 2, 3].map((id) => ({ id, name: 'P' + id }));
  const t = new Tournament(ent, () => true, () => {});
  const bots = t.matches.filter((m) => m.b.bot);
  assert.equal(bots.length, 1);
  assert.equal(t.matches.length, 2);
  assert.equal(bots[0].b.name, 'Dr. Bot');
});

test('picks are hidden during a throw, locked once made, and forfeits are decided', () => {
  const t = new Tournament([{ id: 1, name: 'A' }, { id: 2, name: 'B' }], () => true, () => {});
  t.startThrow(Date.now());
  assert.equal(t.pick(1, 'rock'), 'locked');
  assert.equal(t.pick(1, 'paper'), null, 'no changing your mind');
  assert.equal(t.pick(1, 'dynamite'), null, 'invalid throws are ignored');
  const hv = JSON.stringify(t.hostView());
  assert.ok(!hv.includes('"rock"'), 'the host view never shows a throw before the reveal');
  assert.ok(!JSON.stringify(t.playerView(2)).includes('rock'), 'the opponent never sees it either');
  assert.equal(t.playerView(1).myPick, 'rock');
  t.tick(Date.now() + 10000); // player 2 never throws
  const m = t.matches[0];
  assert.equal(m.done, true);
  assert.equal(m.how, 'forfeit');
  assert.equal(m.winner, m.a.pid === 1 ? 'a' : 'b');
});

// ---------- end to end ----------
function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  const waiters = [];
  const c = {
    ws, inbox, autoplay: false, played: 0,
    open: () => new Promise((r) => ws.on('open', r)),
    send: (o) => ws.send(JSON.stringify(o)),
    next: (pred, ms = 20000) => new Promise((resolve, reject) => {
      const hit = inbox.find(pred);
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return resolve(hit); }
      const w = { pred, resolve: (m) => { clearTimeout(t); inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
      const t = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      waiters.push(w);
    }),
    clear: () => { inbox.length = 0; },
  };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    // autoplay: throw as soon as a throw opens
    if (c.autoplay && m.t === 'p_state' && m.tourney && m.tourney.stage === 'throw' && m.tourney.role === 'alive' && m.tourney.opponent && !m.tourney.myPick && !m.tourney.matchDone) {
      c.played++;
      c.send({ t: 'rps', pick: PICKS[Math.floor(Math.random() * 3)] });
    }
  });
  return c;
}

async function setup(t, names) {
  const { server, game } = createServer(db, null);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  t.after(() => { for (const c of server.wsClients) c.terminate(); server.closeAllConnections(); server.close(); game.stop(); });
  const host = client(port); await host.open();
  host.send({ t: 'host_create' });
  const hosted = await host.next((m) => m.t === 'hosted');
  const players = [];
  for (const name of names) {
    const c = client(port); await c.open();
    c.send({ t: 'join', code: hosted.code, name });
    await c.next((m) => m.t === 'welcome');
    players.push(c);
  }
  return { game, host, hosted, players };
}

test('tournament flow: 3 players, bot match, 4+ rounds, champion crowned and awarded', async (t) => {
  const { game, host, hosted, players } = await setup(t, ['Ada', 'Bo', 'Cy']);
  const room = game.rooms.get(hosted.code);

  // players cannot start it
  players[0].send({ t: 'start_tournament' });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(room.phase, 'lobby');

  players.forEach((p) => { p.autoplay = true; });
  host.clear();
  host.send({ t: 'start_tournament' });
  const first = await host.next((m) => m.t === 'host_state' && m.phase === 'break' && m.tourney);
  assert.equal(first.tourney.entrants, 3);
  assert.ok(first.tourney.maxLives >= 2);
  assert.equal(first.tourney.matches.some((m) => m.b.bot), true, 'the odd player is paired with Dr. Bot');
  assert.equal(first.round, null);

  let sawLockedOnly = false;
  const done = await host.next((m) => {
    if (m.t !== 'host_state' || !m.tourney) return false;
    for (const x of m.tourney.matches) if (m.tourney.stage === 'throw' && !x.done && 'picks' in x) throw new Error('picks leaked to host');
    if (m.tourney.stage === 'throw') sawLockedOnly = true;
    return m.tourney.stage === 'done';
  }, 60000);
  assert.ok(sawLockedOnly);
  assert.ok(done.tourney.roundNo >= 4, `lasted ${done.tourney.roundNo} rounds`);
  assert.ok(done.tourney.champion && done.tourney.champion.name);
  const champ = done.leaderboard.find((p) => p.name === done.tourney.champion.name);
  assert.equal(champ.score >= 30, true, 'the champion is awarded leaderboard points');

  // the champion sees the crown; everyone else sees who won
  const champIdx = ['Ada', 'Bo', 'Cy'].indexOf(done.tourney.champion.name);
  const mine = await players[champIdx].next((m) => m.t === 'p_state' && m.tourney && m.tourney.stage === 'done');
  assert.equal(mine.tourney.role, 'champion');
  assert.equal(mine.tourney.award, 30);

  // players cannot close it; the host can, and scores are kept
  players[0].send({ t: 'end_tournament' });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(room.phase, 'break');
  host.clear();
  host.send({ t: 'end_tournament' });
  const back = await host.next((m) => m.t === 'host_state' && m.phase === 'lobby');
  assert.equal(back.tourney, null);
  assert.equal(back.leaderboard.find((p) => p.name === done.tourney.champion.name).score >= 30, true);
});

test('tournament needs two connected players; a player who stays silent forfeits', async (t) => {
  const { host, players } = await setup(t, ['Solo']);
  host.send({ t: 'start_tournament' });
  assert.match((await host.next((m) => m.t === 'error')).message, /at least 2/);

  const { host: h2, players: ps } = await setup(t, ['Quick', 'Silent']);
  ps[0].autoplay = true; // Silent never throws
  h2.send({ t: 'start_tournament' });
  const rev = await h2.next((m) => m.t === 'host_state' && m.tourney && m.tourney.stage === 'reveal' && m.tourney.matches.every((x) => x.done), 20000);
  assert.equal(rev.tourney.matches[0].how, 'forfeit');
  const loser = rev.tourney.matches[0].winner === 'a' ? rev.tourney.matches[0].b : rev.tourney.matches[0].a;
  assert.equal(loser.name, 'Silent');
  assert.equal(loser.lives, rev.tourney.maxLives - 1);
});
