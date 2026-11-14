'use strict';
// Connections: Differentials. Real server on port 3912, real WebSockets, host + bots.
process.env.PORT = '3912';
process.env.ZEBRA_BANK_KEY = 'k';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createServer } = require('../server/index');
const { validate } = require('../tools/validate/validate_connections');

const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_db.json'), 'utf8'));
const PORT = 3912;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  return {
    ws, inbox,
    open: () => new Promise((r) => ws.on('open', r)),
    send: (o) => ws.send(JSON.stringify(o)),
    next: (pred, ms = 8000) => new Promise((resolve, reject) => {
      const hit = inbox.find(pred);
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return resolve(hit); }
      const w = { pred, resolve: (m) => { clearTimeout(t); const i = inbox.indexOf(m); if (i >= 0) inbox.splice(i, 1); resolve(m); } };
      const t = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      waiters.push(w);
    }),
    clear: () => { inbox.length = 0; },
  };
}

test('puzzle data file validates', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'connections_puzzles.json'), 'utf8'));
  assert.deepEqual(validate(data), []);
  assert.ok(data.puzzles.length >= 24);
});

test('validator rejects a broken puzzle', () => {
  const bad = { puzzles: [{ id: 'x', title: 't', review_notes: 'n', groups: [{ category: 'c', level: 1, explain: 'e', items: ['a', 'b', 'c', 'a'] }] }] };
  assert.ok(validate(bad).length > 0);
});

test('full 3-puzzle run: scoring, mistakes, one away, late joiner, invalid input, reveal, done', async (t) => {
  const { server, game } = createServer(db, { questions: [] });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  t.after(() => { for (const c of server.wsClients) c.terminate(); server.closeAllConnections(); server.close(); game.stop(); });

  const host = client(); await host.open();
  host.send({ t: 'host_create' });
  const hosted = await host.next((m) => m.t === 'hosted');
  const room = game.rooms.get(hosted.code);
  const join = async (name) => {
    const c = client(); await c.open();
    c.send({ t: 'join', code: hosted.code, name });
    await c.next((m) => m.t === 'welcome');
    return c;
  };
  const A = await join('Ada'); const B = await join('Bo'); const C = await join('Cy');
  const ids = { A: null, B: null, C: null };
  for (const p of room.players.values()) ids[{ Ada: 'A', Bo: 'B', Cy: 'C' }[p.name]] = p.id;

  const act = async (c, d) => {
    c.send({ t: 'act', d });
    const m = await c.next((x) => x.t === 'act_ack');
    await sleep(220); // stay under the per-connection rate limit
    return m.d;
  };
  const view = async (c, pred = () => true) => (await c.next((m) => m.t === 'p_state' && m.activity && pred(m.activity))).activity;
  const gTiles = (g) => room.activity.tiles.map((x, i) => (x.g === g ? i : -1)).filter((i) => i >= 0);
  const mixed = (g1, g2) => [...gTiles(g1).slice(0, 2), ...gTiles(g2).slice(0, 2)];
  const levelGroup = (lvl) => room.activity.puzzles[room.activity.pi].groups.findIndex((g) => g.level === lvl);

  // ---- start
  host.send({ t: 'start_activity', type: 'connections' });
  const first = await view(A, (a) => a.type === 'connections' && a.stage === 'play');
  assert.equal(first.tiles.length, 16);
  assert.ok(first.endsInMs > 140000 && first.endsInMs <= 150000);
  assert.equal(first.solved.length, 0);
  const act0 = room.activity;
  assert.equal(act0.puzzles.length, 3);
  assert.equal(new Set(act0.puzzles.map((p) => p.id)).size, 3);

  // no leaks: phone before solving and the projector during play contain no category or group info
  const puzzle1 = act0.puzzles[0];
  const phoneJson = JSON.stringify(first);
  for (const g of puzzle1.groups) { assert.ok(!phoneJson.includes(g.category)); assert.ok(!phoneJson.includes(g.explain)); }
  const hv = (await host.next((m) => m.t === 'host_state' && m.activity && m.activity.stage === 'play')).activity;
  const hostJson = JSON.stringify(hv);
  for (const g of puzzle1.groups) for (const it of g.items) assert.ok(!hostJson.includes(it), 'projector must not show tile text');
  for (const g of puzzle1.groups) assert.ok(!hostJson.includes(g.category));
  assert.equal(hv.rows.length, 4);
  assert.deepEqual(hv.rows.map((r) => r.level), [1, 2, 3, 4]);

  // ---- invalid input (all rejected, no mistake counted)
  const L1 = levelGroup(1); const L2 = levelGroup(2); const L3 = levelGroup(3); const L4 = levelGroup(4);
  const bads = [
    null, 'x', { a: 'nope' }, { a: 'submit' }, { a: 'submit', tiles: 'abcd' },
    { a: 'submit', tiles: [0, 1, 2] }, { a: 'submit', tiles: [0, 1, 2, 3, 4] },
    { a: 'submit', tiles: [0, 0, 1, 2] }, { a: 'submit', tiles: [0, 1, 2, 16] },
    { a: 'submit', tiles: [0, 1, 2, -1] }, { a: 'submit', tiles: [0, 1, 2, 1.5] }, { a: 'submit', tiles: [0, 1, 2, '3'] },
  ];
  for (const b of bads.slice(0, 6)) assert.equal((await act(A, b)).ok, false);
  await sleep(1000);
  for (const b of bads.slice(6)) assert.equal((await act(A, b)).ok, false);
  await sleep(600);
  assert.equal((await view(A)).mistakes, 0, 'invalid input is not a mistake');

  // ---- A: one away, one wrong, then solves all (2 mistakes -> no completion bonus)
  const oneAway = [...gTiles(L1).slice(0, 3), gTiles(L2)[0]];
  const r1 = await act(A, { a: 'submit', tiles: oneAway });
  assert.equal(r1.result, 'oneaway');
  assert.equal((await act(A, { a: 'submit', tiles: oneAway })).ok, false, 'repeating a guess is rejected');
  const r2 = await act(A, { a: 'submit', tiles: mixed(L3, L4) });
  assert.equal(r2.result, 'wrong');

  // B finishes first with no mistakes
  await sleep(600);
  let bPts = 0;
  for (const lvl of [1, 2, 3, 4]) {
    const r = await act(B, { a: 'submit', tiles: gTiles(levelGroup(lvl)) });
    assert.equal(r.result, 'correct'); assert.equal(r.level, lvl);
    bPts += r.pts;
  }
  assert.equal(bPts, 10 + 15 + 20 + 30 + 20 + 10);
  assert.equal((await act(B, { a: 'submit', tiles: gTiles(L1) })).ok, false, 'finished board accepts nothing');
  assert.equal(room.players.get(ids.B).score, 105);

  // already solved tiles are refused
  assert.equal((await act(A, { a: 'submit', tiles: gTiles(L1) })).result, 'correct');
  assert.equal((await act(A, { a: 'submit', tiles: [...gTiles(L1).slice(0, 1), ...gTiles(L2).slice(0, 3)] })).ok, false);
  await sleep(600);
  const viewA = await view(A, (a) => a.solved.length === 1);
  assert.equal(viewA.solved[0].category, puzzle1.groups[L1].category);
  assert.equal(viewA.solved[0].items.length, 4);
  assert.equal(viewA.mistakes, 2);
  for (const lvl of [2, 3, 4]) assert.equal((await act(A, { a: 'submit', tiles: gTiles(levelGroup(lvl)) })).result, 'correct');
  assert.equal(room.players.get(ids.A).score, 75 + 10, 'no completion bonus after mistakes, second finisher bonus');

  // C burns four mistakes and is out
  await sleep(500);
  const wrongs = [[L1, L2], [L1, L3], [L1, L4], [L2, L3]];
  let last;
  for (const [x, y] of wrongs) last = await act(C, { a: 'submit', tiles: mixed(x, y) });
  assert.equal(last.over, true);
  assert.equal((await act(C, { a: 'submit', tiles: gTiles(L1) })).ok, false, 'board over');
  assert.equal(room.players.get(ids.C).score, 0);

  // ---- all done -> reveal
  const rev = await view(A, (a) => a.stage === 'reveal');
  assert.equal(rev.groups.length, 4);
  assert.equal(rev.status, 'solved');
  assert.equal(rev.pts, 85);
  assert.ok(rev.endsInMs > 15000 && rev.endsInMs <= 20000);
  const hrev = (await host.next((m) => m.t === 'host_state' && m.activity && m.activity.stage === 'reveal')).activity;
  assert.equal(hrev.rows.length, 4);
  assert.deepEqual(hrev.rows[0].items, puzzle1.groups[L1].items);
  assert.ok(hrev.rows[0].explain.length > 0);
  assert.ok(hrev.decoy && hrev.decoy.count >= 2, 'decoy tile computed from wrong guesses');
  assert.ok(hrev.solveRate > 0 && hrev.solveRate < 100);
  assert.equal(hrev.rows[0].solved, 2); // A and B solved the yellow group

  // submissions during reveal are rejected
  assert.equal((await act(B, { a: 'submit', tiles: gTiles(L1) })).ok, false);

  // ---- puzzle 2: late joiner, host 'next' skips ahead
  host.send({ t: 'act_host', cmd: 'next', d: null });
  const p2 = await view(A, (a) => a.stage === 'play' && a.pi === 1);
  assert.equal(p2.solved.length, 0); assert.equal(p2.mistakes, 0);
  const D = await join('Di');
  const dView = await view(D, (a) => a.stage === 'play' && a.pi === 1);
  assert.equal(dView.tiles.length, 16);
  assert.equal(dView.solved.length, 0);
  assert.equal(dView.status, 'playing');
  const idD = [...room.players.values()].find((p) => p.name === 'Di').id;
  const d1 = await act(D, { a: 'submit', tiles: gTiles(levelGroup(4)) });
  assert.equal(d1.result, 'correct'); assert.equal(d1.pts, 30);
  assert.equal(room.players.get(idD).score, 30);
  // host forces the reveal early
  host.send({ t: 'act_host', cmd: 'next', d: null });
  await view(D, (a) => a.stage === 'reveal' && a.pi === 1);
  host.send({ t: 'act_host', cmd: 'nonsense', d: 5 }); // ignored
  host.send({ t: 'act_host', cmd: 'next', d: null });

  // ---- puzzle 3: A completes cleanly, then everyone else is idle; host ends the board
  const p3 = await view(A, (a) => a.stage === 'play' && a.pi === 2);
  assert.equal(p3.solved.length, 0);
  let aGain = 0;
  for (const lvl of [4, 3, 2, 1]) aGain += (await act(A, { a: 'submit', tiles: gTiles(levelGroup(lvl)) })).pts;
  assert.equal(aGain, 75 + 20 + 10);
  host.send({ t: 'act_host', cmd: 'next', d: null }); // reveal
  await view(A, (a) => a.stage === 'reveal' && a.pi === 2);
  const lastRev = (await host.next((m) => m.t === 'host_state' && m.activity && m.activity.stage === 'reveal' && m.activity.pi === 2)).activity;
  assert.equal(lastRev.last, true);
  host.send({ t: 'act_host', cmd: 'next', d: null }); // done
  const done = await view(A, (a) => a.stage === 'done');
  assert.equal(room.activity.finished, true);
  assert.ok(done.top.length >= 3 && done.top.length <= 5);
  assert.equal(done.top[0].name, 'Ada');
  assert.equal(done.rank, 1);
  assert.equal(done.runPts, 85 + 105);
  const cDone = await view(C, (a) => a.stage === 'done');
  assert.ok(cDone.rank >= 2);
  const hdone = (await host.next((m) => m.t === 'host_state' && m.activity && m.activity.stage === 'done')).activity;
  assert.equal(hdone.top[0].name, 'Ada');

  // ---- a second run in the same room does not reuse these puzzles
  const used = new Set(act0.puzzles.map((p) => p.id));
  host.send({ t: 'end_activity' });
  for (let i = 0; i < 40 && room.phase !== 'lobby'; i++) await sleep(50);
  assert.equal(room.phase, 'lobby');
  host.send({ t: 'start_activity', type: 'connections' });
  for (let i = 0; i < 40 && room.phase !== 'activity'; i++) await sleep(50);
  assert.equal(room.phase, 'activity');
  for (const p of room.activity.puzzles) assert.ok(!used.has(p.id), 'puzzles do not repeat within a room');
});

test('time up moves a puzzle to the reveal', async (t) => {
  const { server, game } = createServer(db, { questions: [] });
  await new Promise((r) => server.listen(PORT + 1, '127.0.0.1', r));
  t.after(() => { for (const c of server.wsClients) c.terminate(); server.closeAllConnections(); server.close(); game.stop(); });
  const ws = new WebSocket(`ws://127.0.0.1:${PORT + 1}/ws`);
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'host_create' }));
  await sleep(300);
  const code = msgs.find((m) => m.t === 'hosted').code;
  const p = new WebSocket(`ws://127.0.0.1:${PORT + 1}/ws`);
  const pm = [];
  p.on('message', (d) => pm.push(JSON.parse(d.toString())));
  await new Promise((r) => p.on('open', r));
  p.send(JSON.stringify({ t: 'join', code, name: 'Solo' }));
  await sleep(300);
  ws.send(JSON.stringify({ t: 'start_activity', type: 'connections' }));
  await sleep(400);
  const room = game.rooms.get(code);
  room.activity.deadline = Date.now() + 300;
  await sleep(900);
  assert.equal(room.activity.stage, 'reveal');
  assert.ok(pm.some((m) => m.t === 'p_state' && m.activity && m.activity.stage === 'reveal'));
  p.close(); ws.close();
});
