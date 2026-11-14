'use strict';
/*
 * Confidence Ladder: real server on port 3915, host + bot players over WebSockets.
 *
 * Rule interpretations (see server/activities/ladder.js):
 *  - Prizes are per rung, not cumulative: the banked prize is the prize of the last completed step.
 *  - Safe havens: clearing step 3 guarantees 15, clearing step 6 guarantees 60.
 *  - Lock is final (the phone does the "Final answer?" confirm). A player who does nothing is wrong at the deadline.
 *  - The question closes early once every connected climbing player has locked or walked.
 *  - "Ask the room" percentages are over the OTHER climbing players who have locked so far.
 */
process.env.PORT = '3915';
process.env.ZEBRA_BANK_KEY = 'k';
process.env.ZEBRA_LADDER_ASK_MS = '2500';
process.env.ZEBRA_LADDER_REVEAL_MS = '600';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createServer } = require('../server/index');
const Ladder = require('../server/activities/ladder');

const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_db.json'), 'utf8'));
const mc = {
  questions: Array.from({ length: 120 }, (_, i) => ({
    id: `m${i}`, q: `Mock question ${i}?`, correct: `RIGHT ${i}`, wrong: [`wrong a${i}`, `wrong b${i}`, `wrong c${i}`],
    why: `Because ${i}.`, tags: [], level: (i % 10) + 1,
  })),
};

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  const waiters = [];
  const c = {
    ws, inbox, leaks: [],
    open: () => new Promise((r) => ws.on('open', r)),
    send: (o) => ws.send(JSON.stringify(o)),
    next: (pred, ms = 9000) => new Promise((resolve, reject) => {
      const hit = inbox.find(pred);
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return resolve(hit); }
      const w = { pred, resolve: (m) => { clearTimeout(t); inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
      const t = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      waiters.push(w);
    }),
  };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const a = m.activity;
    if (a && a.stage === 'ask' && /"correct"|Because/.test(JSON.stringify(a))) c.leaks.push(a);
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  return c;
}

const rightIdx = (a) => a.options.findIndex((o) => o.startsWith('RIGHT'));
const wrongIdx = (a) => a.options.findIndex((o) => !o.startsWith('RIGHT'));
const ask = (c, n) => c.next((m) => m.t === 'p_state' && m.activity && m.activity.stage === 'ask' && m.activity.step === n).then((m) => m.activity);
const reveal = (c, n) => c.next((m) => m.t === 'p_state' && m.activity && m.activity.stage === 'reveal' && m.activity.step === n).then((m) => m.activity);
const act = async (c, d) => { c.send({ t: 'act', d }); return (await c.next((m) => m.t === 'act_ack')).d; };

test('Confidence Ladder: full climb with walk, fall, timeout, lifelines, top prize, late joiner', { timeout: 90000 }, async (t) => {
  const { server, game } = createServer(db, mc);
  await new Promise((r) => server.listen(3915, '127.0.0.1', r));
  t.after(() => { for (const c of server.wsClients) c.terminate(); server.closeAllConnections(); server.close(); game.stop(); });
  const host = client(3915); await host.open();
  host.send({ t: 'host_create' });
  const hosted = await host.next((m) => m.t === 'hosted');
  const everyone = [host];
  const join = async (name) => {
    const c = client(3915); await c.open();
    c.send({ t: 'join', code: hosted.code, name });
    await c.next((m) => m.t === 'welcome');
    everyone.push(c);
    return c;
  };
  const C = await join('Champ'), W = await join('Walker'), F = await join('Faller'), T = await join('Timer');
  const room = game.rooms.get(hosted.code);
  const score = (name) => [...room.players.values()].find((p) => p.name === name).score;

  host.send({ t: 'start_activity', type: 'ladder' });

  // ---- step 1 ----
  const a1 = {};
  for (const [k, c] of Object.entries({ C, W, F, T })) a1[k] = await ask(c, 1);
  const hv1 = await host.next((m) => m.t === 'host_state' && m.activity && m.activity.stage === 'ask' && m.activity.step === 1);
  assert.equal(hv1.activity.level, 1, 'step 1 uses a level-1 question');
  assert.equal(a1.C.options.length, 4);
  assert.equal(a1.C.me.status, 'climbing');

  // E joins while the ladder is still on step 1: allowed, then walks away with 0
  const E = await join('Early');
  const e1 = await ask(E, 1);
  assert.equal(e1.me.status, 'climbing');

  // invalid inputs
  assert.equal((await act(C, { lock: 7 })).ok, false);
  assert.equal((await act(C, { lock: '1' })).ok, false);
  assert.equal((await act(C, { lock: -1 })).ok, false);
  assert.equal((await act(C, { lock: 1.5 })).ok, false);
  assert.equal((await act(C, { lifeline: 'bogus' })).ok, false);
  assert.equal((await act(C, {})).ok, false);
  assert.equal((await act(C, null)).ok, false);
  assert.equal((await act(C, 'lock')).ok, false);
  assert.equal((await act(C, { walk: 'yes' })).ok, false);

  // lifelines before anyone locked
  const sen0 = await act(T, { lifeline: 'senior' });
  assert.equal(sen0.ok, true); assert.equal(sen0.result.none, true);
  assert.equal((await act(T, { lifeline: 'senior' })).ok, false, 'each lifeline once');
  const room0 = await act(F, { lifeline: 'room' });
  assert.equal(room0.result.n, 0); assert.match(room0.result.note, /Nobody/);
  const fifty = await act(C, { lifeline: 'fifty' });
  assert.equal(fifty.result.hide.length, 2);
  assert.ok(!fifty.result.hide.includes(rightIdx(a1.C)), '50:50 never hides the right answer');
  const withFifty = await C.next((m) => m.t === 'p_state' && m.activity && m.activity.step === 1 && m.activity.me.lifeResults && m.activity.me.lifeResults.fifty);
  assert.equal(withFifty.activity.me.lifelines.fifty, true, 'lifeline persists in the player view');

  const walkE = await act(E, { walk: true });
  assert.equal(walkE.ok, true); assert.equal(walkE.points, 0);
  assert.equal((await act(E, { lock: 0 })).ok, false, 'walked player cannot act');

  assert.equal((await act(W, { lock: rightIdx(a1.W) })).ok, true);
  assert.equal((await act(W, { lock: 0 })).ok, false, 'one lock per question');
  assert.equal((await act(W, { lifeline: 'fifty' })).ok, false, 'no lifeline after locking');
  await act(F, { lock: rightIdx(a1.F) });
  await act(T, { lock: rightIdx(a1.T) });
  await act(C, { lock: rightIdx(a1.C) });

  const r1 = await reveal(C, 1);
  assert.equal(r1.correct, rightIdx(a1.C));
  assert.equal(r1.me.result, 'right');
  assert.equal(r1.ladder[1], 4, 'four players on rung 1');
  assert.equal(r1.ladder[0], 1, 'the walker stays on the start rung');
  assert.equal(r1.pct.reduce((a, b) => a + b, 0), 100);
  const hr1 = await host.next((m) => m.t === 'host_state' && m.activity && m.activity.stage === 'reveal' && m.activity.step === 1);
  assert.equal(hr1.activity.correct, rightIdx(a1.C));
  assert.ok(hr1.activity.why.startsWith('Because'));

  // ---- step 2: Ask the room ----
  const a2 = {};
  for (const [k, c] of Object.entries({ C, W, F, T })) a2[k] = await ask(c, 2);
  assert.equal(a2.C.me.completed, 1);
  await act(W, { lock: rightIdx(a2.W) });
  await act(F, { lock: rightIdx(a2.F) });
  await act(T, { lock: rightIdx(a2.T) });
  const roomR = await act(C, { lifeline: 'room' });
  assert.equal(roomR.result.n, 3);
  assert.equal(roomR.result.pct[rightIdx(a2.C)], 100);
  assert.equal(roomR.result.note, '');
  assert.equal((await act(C, { lifeline: 'fifty' })).ok, false, 'fifty already used');
  await act(C, { lock: rightIdx(a2.C) });
  await reveal(C, 2);

  // ---- step 3: walk, senior, timeout, late joiner ----
  const a3 = {};
  for (const [k, c] of Object.entries({ C, W, F, T })) a3[k] = await ask(c, 3);
  const L = await join('Late');
  const l3 = await ask(L, 3);
  assert.equal(l3.me.status, 'spectator', 'late joiner after step 1 only watches');
  assert.equal((await act(L, { lock: 0 })).ok, false);
  assert.equal((await act(L, { lifeline: 'fifty' })).ok, false);

  const walkW = await act(W, { walk: true });
  assert.equal(walkW.points, 10, 'walking after step 2 banks 10');
  await act(F, { lock: rightIdx(a3.F) });
  const sen = await act(C, { lifeline: 'senior' });
  assert.equal(sen.result.option, rightIdx(a3.F));
  assert.equal(typeof sen.result.rank, 'number');
  assert.ok(!('name' in sen.result), 'no names with the senior lifeline');
  await act(C, { lock: rightIdx(a3.C) });
  // Timer does nothing: the question must wait for the 2.5 s deadline
  const started = Date.now();
  const r3t = await reveal(T, 3);
  assert.ok(Date.now() - started >= 1000, 'question waited for the idle player');
  assert.equal(r3t.me.result, 'timeout');
  assert.equal(r3t.me.status, 'fell');
  assert.equal(r3t.me.final, 0, 'before step 3 is cleared the fall is to 0');
  const r3c = await reveal(C, 3);
  assert.equal(r3c.me.safePoints, 15);
  assert.equal(r3c.climbing, 2);

  // ---- step 4: Faller is wrong and drops to the step-3 safe haven ----
  const a4 = {};
  for (const [k, c] of Object.entries({ C, F, W })) a4[k] = await ask(c, 4);
  assert.equal(a4.W.me.status, 'walked');
  assert.equal((await act(W, { lock: 0 })).ok, false, 'finished players cannot act');
  assert.equal(a4.F.me.safePoints, 15);
  await act(F, { lock: wrongIdx(a4.F) });
  await act(C, { lock: rightIdx(a4.C) });
  const r4f = await reveal(F, 4);
  assert.equal(r4f.me.result, 'wrong');
  assert.equal(r4f.me.final, 15);
  assert.equal(r4f.me.status, 'fell');
  // spectators see the answer only now
  const r4w = await reveal(W, 4);
  assert.equal(r4w.correct, rightIdx(a4.C));

  // ---- steps 5..10: Champ alone ----
  for (let n = 5; n <= 10; n++) {
    const a = await ask(C, n);
    assert.equal(a.me.status, 'climbing');
    assert.equal((await act(C, { lock: rightIdx(a) })).ok, true);
    const r = await reveal(C, n);
    assert.equal(r.me.result, 'right');
    if (n === 6) {
      assert.equal(r.me.safePoints, 60);
      host.send({ t: 'act_host', cmd: 'next' }); // host can skip the wait
    }
    if (n === 10) assert.equal(r.me.status, 'top');
  }

  // ---- done ----
  const done = await C.next((m) => m.t === 'p_state' && m.activity && m.activity.stage === 'done');
  assert.equal(done.activity.me.won, 150);
  assert.deepEqual(done.activity.winnings.map((w) => [w.name, w.points]), [['Champ', 150], ['Faller', 15], ['Walker', 10], ['Timer', 0], ['Early', 0]]);
  assert.deepEqual(done.activity.reached, [4, 4, 2, 1, 1, 1, 1, 1, 1, 1]);
  const hdone = await host.next((m) => m.t === 'host_state' && m.activity && m.activity.stage === 'done');
  assert.equal(hdone.activity.finished, true);
  assert.equal(score('Champ'), 150);
  assert.equal(score('Faller'), 15);
  assert.equal(score('Walker'), 10);
  assert.equal(score('Timer'), 0);
  assert.equal(score('Early'), 0);
  assert.equal(score('Late'), 0);
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(score('Champ'), 150, 'points are awarded once');
  assert.equal(room.usedLadder.size, 10, 'ten distinct questions used');
  for (const c of everyone) assert.deepEqual(c.leaks, [], 'no correct index or explanation before reveal');
});

test('ladder: bank without levels uses level 5, never repeats, ends when the bank runs out', () => {
  const players = new Map([['p1', { id: 'p1', name: 'A', score: 0, connected: true }]]);
  const bank = Array.from({ length: 3 }, (_, i) => ({ id: `n${i}`, q: `q${i}`, correct: 'r', wrong: ['a', 'b', 'c'], why: '', tags: [], level: 0 }));
  const room = { players, db: { mc: bank }, addScore: (pid, n) => { players.get(pid).score += n; }, ranks: () => ({ sorted: [...players.values()], rank: new Map([['p1', 1]]) }) };
  const act = new Ladder(room);
  const seen = new Set();
  for (let step = 1; step <= 3; step++) {
    assert.equal(act.step, step);
    seen.add(act.q.id);
    assert.equal(act.playerView('p1').correct, undefined);
    act.handle(players.get('p1'), { lock: act.q.correct });
    assert.equal(act.stage, 'reveal');
    act.hostCommand('next');
  }
  assert.equal(seen.size, 3);
  assert.equal(act.stage, 'done', 'bank exhausted after 3 questions');
  assert.equal(players.get('p1').score, 15, 'banked prize for step 3');
  assert.equal(act.finished, true);
});
