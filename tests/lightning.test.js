'use strict';
// Lightning round add-on, host restart and host debug: real server, real WebSockets.
process.env.ZEBRA_ROUND_SECONDS = '4';
process.env.ZEBRA_MC_SECONDS = '3'; // after the 4 s normal timer, 3 s of lightning questions
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createServer } = require('../server/index');

const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_db.json'), 'utf8'));
const mc = {
  questions: Array.from({ length: 14 }, (_, i) => ({
    id: `q${i}`, q: `Question ${i}?`, correct: `RIGHT ${i}`, wrong: [`wrong a${i}`, `wrong b${i}`, `wrong c${i}`], why: `Because ${i}.`, tags: [],
  })).concat([{ id: 'bad', q: 'Only three options?', correct: 'x', wrong: ['y', 'z'] }]), // must be skipped
};

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
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
      const w = { pred, resolve: (m) => { clearTimeout(t); inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
      const t = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      waiters.push(w);
    }),
    clear: () => { inbox.length = 0; },
  };
}

async function setup(t, mcBank = mc) {
  const { server, game } = createServer(db, mcBank);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  t.after(() => { for (const c of server.wsClients) c.terminate(); server.closeAllConnections(); server.close(); game.stop(); });
  const host = client(port); await host.open();
  host.send({ t: 'host_create' });
  const hosted = await host.next((m) => m.t === 'hosted');
  const join = async (name) => {
    const c = client(port); await c.open();
    c.send({ t: 'join', code: hosted.code, name });
    await c.next((m) => m.t === 'welcome');
    return c;
  };
  return { server, game, port, host, hosted, join };
}

const rightIdx = (q) => q.options.findIndex((o) => o.startsWith('RIGHT'));
const wrongIdx = (q) => q.options.findIndex((o) => !o.startsWith('RIGHT'));

test('invalid questions are skipped when the bank loads', async (t) => {
  const { game } = await setup(t);
  assert.equal(game.db.mc.length, 14);
});

test('lightning round: questions open in the last seconds, right earns, wrong costs, typing is locked', async (t) => {
  const { game, host, hosted, join } = await setup(t);
  const a = await join('Ada');
  const b = await join('Bo');

  host.send({ t: 'set_options', lightning: true });
  const on = await host.next((m) => m.t === 'host_state' && m.lightning && m.lightning.on);
  assert.equal(on.lightning.available, true);
  assert.equal(on.lightning.pointsRight, 15);
  assert.equal(on.lightning.pointsWrong, -5);

  // players cannot toggle it
  a.send({ t: 'set_options', lightning: false });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(game.rooms.get(hosted.code).lightning, true);

  host.send({ t: 'start_round' });
  const early = await a.next((m) => m.t === 'p_state' && m.phase === 'round');
  assert.equal(early.lightning.on, true);
  assert.equal(early.lightning.active, false);
  assert.equal(early.lightning.q, null, 'no question before the window opens');
  a.send({ t: 'mc_answer', qid: 'q0', choice: 0 });
  assert.equal((await a.next((m) => m.t === 'mc_ack')).ok, false, 'cannot answer before the window opens');

  const live = await a.next((m) => m.t === 'p_state' && m.lightning && m.lightning.active && m.lightning.q);
  const text = JSON.stringify(live);
  assert.ok(!/RIGHT.*correct|correctIdx|Because/.test(text.replace(/RIGHT \d/g, '')), 'the state must not leak the answer or explanation');
  assert.equal(live.lightning.q.options.length, 4);
  assert.ok(rightIdx(live.lightning.q) >= 0);

  // typing is locked while the questions are live
  a.send({ t: 'answer', text: 'anything' });
  const typed = await a.next((m) => m.t === 'ack');
  assert.equal(typed.ok, false);
  assert.match(typed.error, /Lightning/);

  // invalid input
  a.send({ t: 'mc_answer', qid: live.lightning.q.id, choice: 9 });
  assert.equal((await a.next((m) => m.t === 'mc_ack')).ok, false);
  a.send({ t: 'mc_answer', qid: 'not-the-open-question', choice: 0 });
  assert.equal((await a.next((m) => m.t === 'mc_ack')).ok, false);

  // right answer
  a.send({ t: 'mc_answer', qid: live.lightning.q.id, choice: rightIdx(live.lightning.q) });
  const ackA = await a.next((m) => m.t === 'mc_ack');
  assert.equal(ackA.ok, true); assert.equal(ackA.correct, true); assert.equal(ackA.delta, 15);
  assert.equal(ackA.correctIdx, rightIdx(live.lightning.q));
  assert.match(ackA.why, /^Because/);
  // answering the same question twice is refused (it has moved on)
  a.send({ t: 'mc_answer', qid: live.lightning.q.id, choice: 0 });
  assert.equal((await a.next((m) => m.t === 'mc_ack')).ok, false);
  const nextA = await a.next((m) => m.t === 'p_state' && m.lightning && m.lightning.right === 1 && m.lightning.q);
  assert.notEqual(nextA.lightning.q.id, live.lightning.q.id, 'the next question is served');

  // wrong answer
  const liveB = await b.next((m) => m.t === 'p_state' && m.lightning && m.lightning.active && m.lightning.q);
  b.send({ t: 'mc_answer', qid: liveB.lightning.q.id, choice: wrongIdx(liveB.lightning.q) });
  const ackB = await b.next((m) => m.t === 'mc_ack');
  assert.equal(ackB.correct, false); assert.equal(ackB.delta, -5);

  const hs = await host.next((m) => m.t === 'host_state' && m.lightning && m.lightning.active && m.lightning.answered >= 2);
  assert.equal(hs.lightning.answered >= 2, true);

  // reveal: scores apply at the end and the summary is on the host screen
  const revA = await a.next((m) => m.t === 'reveal');
  assert.equal(revA.roundPoints, 15);
  assert.equal(revA.score, 15);
  assert.equal(revA.mc.right, 1); assert.equal(revA.mc.items[0].ok, true); assert.ok(revA.mc.items[0].why);
  const revB = await b.next((m) => m.t === 'reveal');
  assert.equal(revB.roundPoints, -5);
  assert.equal(revB.mc.items[0].ok, false);
  const rev = await host.next((m) => m.t === 'host_state' && m.phase === 'reveal');
  assert.equal(rev.reveal.lightning.right, 1);
  assert.equal(rev.reveal.lightning.wrong, 1);
  assert.equal(rev.reveal.lightning.top[0].name, 'Ada');
  assert.ok(rev.reveal.lightning.questions.length >= 1);
  assert.equal(JSON.stringify(rev).includes('"items"'), false, 'per-player question detail stays off the projector');
});

test('lightning off: no questions and mc_answer is refused', async (t) => {
  const { host, join } = await setup(t);
  const a = await join('Ada');
  host.send({ t: 'start_round' });
  const ps = await a.next((m) => m.t === 'p_state' && m.phase === 'round');
  assert.equal(ps.lightning, null);
  a.send({ t: 'mc_answer', qid: 'q0', choice: 0 });
  assert.equal((await a.next((m) => m.t === 'mc_ack')).ok, false);
  await a.next((m) => m.t === 'reveal');
});

test('lightning cannot be switched on without a question bank', async (t) => {
  const { host } = await setup(t, null);
  host.send({ t: 'set_options', lightning: true });
  const err = await host.next((m) => m.t === 'error');
  assert.match(err.message, /No lightning questions/);
  const st = await host.next((m) => m.t === 'host_state');
  assert.equal(st.lightning.on, false);
  assert.equal(st.lightning.available, false);
});

test('restart: scores cleared and back to lobby, players kept or removed', async (t) => {
  const { game, host, hosted, join } = await setup(t);
  const a = await join('Ada');
  host.send({ t: 'start_round' });
  a.send({ t: 'answer', text: 'whipple' });
  await a.next((m) => m.t === 'ack');
  await host.next((m) => m.t === 'host_state' && m.phase === 'reveal');
  const room = game.rooms.get(hosted.code);
  room.players.get(1).score = 40;

  // players cannot restart
  a.send({ t: 'restart' });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(room.phase, 'reveal');

  host.clear(); a.clear();
  host.send({ t: 'restart' });
  const lobby = await host.next((m) => m.t === 'host_state' && m.phase === 'lobby' && m.roundNo === 0);
  assert.equal(lobby.players.length, 1);
  assert.equal(lobby.players[0].score, 0);
  assert.equal(lobby.round, null);
  assert.equal(lobby.reveal, null);
  const pl = await a.next((m) => m.t === 'p_state' && m.phase === 'lobby');
  assert.equal(pl.score, 0);

  // a new round works after a restart and the round counter starts over
  host.clear();
  host.send({ t: 'start_round' });
  const r1 = await host.next((m) => m.t === 'host_state' && m.phase === 'round');
  assert.equal(r1.roundNo, 1);
  host.send({ t: 'end_round' });
  await host.next((m) => m.t === 'host_state' && m.phase === 'reveal');

  host.clear(); a.clear();
  host.send({ t: 'restart', kickAll: true });
  const empty = await host.next((m) => m.t === 'host_state' && m.phase === 'lobby' && m.players.length === 0);
  assert.equal(empty.roundNo, 0);
  const kicked = await a.next((m) => m.t === 'error' && m.fatal);
  assert.match(kicked.message, /reset/);
});

test('debug: host-only, useful, and never leaks keys or tokens', async (t) => {
  const { host, hosted, join } = await setup(t);
  const a = await join('Ada');
  host.send({ t: 'start_round' });
  a.send({ t: 'answer', text: 'whipple disease' });
  await a.next((m) => m.t === 'ack');

  a.clear();
  a.send({ t: 'debug' });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(a.inbox.some((m) => m.t === 'debug_info'), false, 'players get no debug info');

  host.send({ t: 'debug' });
  const d = await host.next((m) => m.t === 'debug_info');
  assert.equal(d.room.code, hosted.code);
  assert.equal(d.room.phase, 'round');
  assert.equal(d.room.players.length, 1);
  assert.equal(d.room.players[0].name, 'Ada');
  assert.ok(d.room.promptId);
  assert.ok(d.sockets >= 2);
  assert.equal(d.mcQuestions, 14);
  assert.ok(d.room.log.some((l) => /join: Ada/.test(l.msg)));
  assert.ok(d.room.log.some((l) => /answer: Ada/.test(l.msg)));
  const raw = JSON.stringify(d);
  assert.equal(raw.includes(hosted.hostKey), false, 'host key is never echoed');
  assert.equal(/token/i.test(raw), false);
});

test('lightning is a stage after the normal timer, and End skips ahead to it', async (t) => {
  const { host, join } = await setup(t);
  const a = await join('Ada');
  host.send({ t: 'set_options', lightning: true });
  await host.next((m) => m.t === 'host_state' && m.lightning && m.lightning.on);
  host.send({ t: 'start_round' });
  const text = await a.next((m) => m.t === 'p_state' && m.phase === 'round');
  assert.equal(text.roundSeconds, 4, 'the normal timer keeps its normal length');
  assert.ok(text.endsInMs > 3000 && text.endsInMs <= 4000);
  assert.equal(text.lightning.active, false);

  host.send({ t: 'end_round' }); // skip ahead
  const lt = await a.next((m) => m.t === 'p_state' && m.lightning && m.lightning.active);
  assert.equal(lt.roundSeconds, 3);
  assert.ok(lt.endsInMs > 2000 && lt.endsInMs <= 3000, 'the lightning stage gets its own full countdown');
  const hs = await host.next((m) => m.t === 'host_state' && m.lightning && m.lightning.active);
  assert.equal(hs.roundSeconds, 3);

  host.send({ t: 'end_round' }); // second press ends the round
  const rev = await host.next((m) => m.t === 'host_state' && m.phase === 'reveal');
  assert.equal(rev.phase, 'reveal');
});
