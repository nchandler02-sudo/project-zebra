'use strict';
// End-to-end protocol test: real server, real WebSockets, host + 2 players, standard and Impossible rounds.
process.env.ZEBRA_ROUND_SECONDS = '2';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createServer } = require('../server/index');

const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_db.json'), 'utf8'));

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
    next: (pred, ms = 6000) => new Promise((resolve, reject) => {
      const hit = inbox.find(pred);
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return resolve(hit); }
      const w = { pred, resolve: (m) => { clearTimeout(t); inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
      const t = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      waiters.push(w);
    }),
    close: () => ws.close(),
  };
}

test('full game flow', async (t) => {
  const { server, game } = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  t.after(() => { for (const c of server.wsClients) c.terminate(); server.closeAllConnections(); server.close(); game.stop(); });

  const host = client(port); await host.open();
  host.send({ t: 'host_create' });
  const hosted = await host.next((m) => m.t === 'hosted');
  assert.match(hosted.code, /^[A-Z]{4}$/);

  host.send({ t: 'set_options', difficulty: 'standard' });
  await host.next((m) => m.t === 'host_state' && m.difficulty === 'standard');

  const a = client(port); await a.open();
  a.send({ t: 'join', code: hosted.code, name: '  Ada  ' });
  const wa = await a.next((m) => m.t === 'welcome');
  assert.equal(wa.name, 'Ada');
  const b = client(port); await b.open();
  b.send({ t: 'join', code: hosted.code.toLowerCase(), name: 'Ada' });
  const wb = await b.next((m) => m.t === 'welcome');
  assert.equal(wb.name, 'Ada 2', 'duplicate nicknames are made unique');

  // players cannot control the game
  a.send({ t: 'start_round' });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(game.rooms.get(hosted.code).phase, 'lobby');

  host.send({ t: 'start_round' });
  const hs = await host.next((m) => m.t === 'host_state' && m.phase === 'round');
  assert.equal(hs.round.impossible, false);
  assert.equal(hs.players.length, 2);
  const ps = await a.next((m) => m.t === 'p_state' && m.phase === 'round');
  assert.ok(ps.endsInMs > 0 && ps.endsInMs <= 2000);

  a.send({ t: 'answer', text: 'erdheim chestr disease' }); // typo
  const ack1 = await a.next((m) => m.t === 'ack');
  assert.equal(ack1.ok, true); assert.equal(ack1.used, 1);
  assert.equal(ack1.points, undefined, 'ack must not leak correctness');
  await new Promise((r) => setTimeout(r, 130));
  a.send({ t: 'answer', text: 'ECD' }); // same answer via alias
  const ack2 = await a.next((m) => m.t === 'ack');
  assert.equal(ack2.ok, true, 'same answer typed another way is silently ignored outside Casual (no oracle)');
  assert.equal(ack2.duplicate, true);
  assert.equal(ack2.used, 1, 'and uses no slot');
  await new Promise((r) => setTimeout(r, 130));
  a.send({ t: 'answer', text: 'TB' });
  assert.equal((await a.next((m) => m.t === 'ack')).ok, true);
  await new Promise((r) => setTimeout(r, 130));
  b.send({ t: 'answer', text: 'whipples disease' });
  assert.equal((await b.next((m) => m.t === 'ack')).ok, true);

  const mid = await host.next((m) => m.t === 'host_state' && m.round && m.round.depth > 0);
  assert.equal(mid.round.depth, 92);
  assert.ok(!JSON.stringify(mid).includes('whipple'), 'answers hidden from host until reveal');

  const ra = await a.next((m) => m.t === 'reveal', 5000);
  assert.equal(ra.roundPoints, 102);
  assert.equal(ra.results.find((r) => r.answer === 'Erdheim-Chester disease').tier, 'attending');
  assert.equal(ra.rank, 1);
  const rb = await b.next((m) => m.t === 'reveal');
  assert.equal(rb.roundPoints, -10);
  assert.equal(rb.results[0].tier, 'trap');
  assert.equal(rb.rank, 2);
  const hr = await host.next((m) => m.t === 'host_state' && m.phase === 'reveal');
  assert.equal(hr.reveal.bestFind.name, 'Ada');
  assert.ok(hr.reveal.topMissed.some((x) => x.answer === 'Schnitzler syndrome' && x.pearl));
  assert.ok(hr.reveal.topMissed.every((x) => x.points > 0), 'traps are never listed as missed zebras');

  // Impossible round, reconnect with token mid-round
  host.send({ t: 'start_round', impossible: true });
  const imp = await host.next((m) => m.t === 'host_state' && m.phase === 'round' && m.roundNo === 2);
  assert.equal(imp.round.impossible, true);
  a.close();
  await new Promise((r) => setTimeout(r, 150));
  const a2 = client(port); await a2.open();
  a2.send({ t: 'join', code: hosted.code, name: 'ignored', token: wa.token });
  const wa2 = await a2.next((m) => m.t === 'welcome');
  assert.equal(wa2.pid, wa.pid, 'token resumes same player');
  const ps2 = await a2.next((m) => m.t === 'p_state');
  assert.equal(ps2.round.impossible, true);
  assert.equal(ps2.score, 102);

  // host resume
  host.close();
  const host2 = client(port); await host2.open();
  host2.send({ t: 'host_resume', code: hosted.code, hostKey: hosted.hostKey });
  assert.equal((await host2.next((m) => m.t === 'hosted')).code, hosted.code);
  const bad = client(port); await bad.open();
  bad.send({ t: 'host_resume', code: hosted.code, hostKey: 'nope' });
  assert.equal((await bad.next((m) => m.t === 'error')).fatal, true);

  for (const c of [a2, b, host2, bad]) c.close();
});

test('bad joins', async (t) => {
  const { server, game } = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { for (const c of server.wsClients) c.terminate(); server.closeAllConnections(); server.close(); game.stop(); });
  const c = client(server.address().port); await c.open();
  c.send({ t: 'join', code: 'ZZZZ', name: 'x' });
  assert.equal((await c.next((m) => m.t === 'error')).fatal, true);
  // static hardening
  const res = await fetch(`http://127.0.0.1:${server.address().port}/..%2fpackage.json`);
  assert.equal(res.status, 404);
  const ok = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
  assert.equal(await ok.text(), 'ok');
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  c.close();
});

test('casual (default) rules: floor, free traps, feedback, misses do not use slots', async (t) => {
  const { server, game } = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { for (const c of server.wsClients) c.terminate(); server.closeAllConnections(); server.close(); game.stop(); });
  const port = server.address().port;
  const host = client(port); await host.open();
  host.send({ t: 'host_create' });
  const hosted = await host.next((m) => m.t === 'hosted');
  const a = client(port); await a.open();
  a.send({ t: 'join', code: hosted.code, name: 'Ada' });
  await a.next((m) => m.t === 'welcome');
  host.send({ t: 'start_round' });
  const hs = await host.next((m) => m.t === 'host_state' && m.phase === 'round');
  assert.equal(hs.difficulty, 'casual');
  assert.equal(hs.maxAnswers, 5);
  const ps = await a.next((m) => m.t === 'p_state' && m.phase === 'round');
  assert.equal(ps.feedback, true);
  const say = async (text) => { a.send({ t: 'answer', text }); const r = await a.next((m) => m.t === 'ack'); await new Promise((x) => setTimeout(x, 130)); return r; };

  const miss = await say('banana');
  assert.equal(miss.ok, true); assert.equal(miss.matched, false); assert.equal(miss.used, 0, 'a miss uses no slot');
  const hit = await say('lymphoma'); // base 8 -> floor 10
  assert.equal(hit.matched, true); assert.equal(hit.used, 1);
  assert.equal(hit.points, undefined);
  const trap = await say('whipple disease'); // trap -> 0
  assert.equal(trap.matched, true);
  const dup = await say('Lymphoma');
  assert.equal(dup.ok, false);
  const zebra = await say('schnitzler');
  assert.equal(zebra.matched, true);

  host.send({ t: 'end_round' });
  const rv = await a.next((m) => m.t === 'reveal');
  const byAnswer = Object.fromEntries(rv.results.filter((r) => r.matched).map((r) => [r.answer, r]));
  assert.equal(byAnswer.Lymphoma.points, 10, 'casual floor lifts 8 to 10');
  assert.equal(byAnswer['Whipple disease'].points, 0, 'traps are free in casual');
  assert.match(byAnswer['Whipple disease'].tierLabel, /no penalty/);
  assert.equal(byAnswer['Schnitzler syndrome'].points, 93);
  assert.equal(rv.roundPoints, 103);
  assert.ok(rv.results.some((r) => !r.matched && r.points === 0), 'misses still listed at reveal');
  a.close(); host.close();
});

test('standard rules: trap only costs points when the room piles on', async (t) => {
  const { server, game } = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { for (const c of server.wsClients) c.terminate(); server.closeAllConnections(); server.close(); game.stop(); });
  const port = server.address().port;
  const host = client(port); await host.open();
  host.send({ t: 'host_create' });
  const hosted = await host.next((m) => m.t === 'hosted');
  host.send({ t: 'set_options', difficulty: 'standard' });
  await host.next((m) => m.t === 'host_state' && m.difficulty === 'standard');
  const names = ['A', 'B', 'C', 'D'];
  const ps = [];
  for (const n of names) { const c = client(port); await c.open(); c.send({ t: 'join', code: hosted.code, name: n }); await c.next((m) => m.t === 'welcome'); ps.push(c); }
  host.send({ t: 'start_round' });
  for (const c of ps) await c.next((m) => m.t === 'p_state' && m.phase === 'round');
  // only A names the trap (1 of 4 = 25% < 30%): free. B and C both name tuberculosis.
  ps[0].send({ t: 'answer', text: 'whipple disease' });
  ps[1].send({ t: 'answer', text: 'tuberculosis' });
  ps[2].send({ t: 'answer', text: 'tuberculosis' });
  ps[3].send({ t: 'answer', text: 'whipple' }); // second trap namer -> 2 of 4 = 50%: now it costs
  for (const c of ps) await c.next((m) => m.t === 'ack');
  host.send({ t: 'end_round' });
  const ra = await ps[0].next((m) => m.t === 'reveal');
  assert.equal(ra.roundPoints, -10, 'once half the room named it, the trap costs 10');
  const rb = await ps[1].next((m) => m.t === 'reveal');
  assert.equal(rb.roundPoints, 10);
  for (const c of ps) c.close(); host.close();
});

test('teaching reveal: attainable misses first, one zebra, never traps', async (t) => {
  const { Room, Database } = require('../server/game');
  const room = new Room('TEST', 'k', new Database(db));
  room.prompt = room.db.prompts[0];
  room.found = new Set([0]); // Tuberculosis found
  const out = room.teachingMisses();
  assert.ok(out.length >= 3 && out.length <= 5);
  assert.ok(out.every((x) => x.points > 0), 'no traps');
  assert.ok(out.some((x) => x.kind === 'zebra' && x.points >= 80));
  assert.ok(out.filter((x) => x.kind === 'teach').every((x) => x.points <= 59));
  assert.ok(!out.some((x) => x.answer === 'Tuberculosis'), 'found answers are not listed');
});

test('prompt level preference: casual picks easy prompts, zebra avoids them, standard mixes', () => {
  const { Room, Database } = require('../server/game');
  const base = db.prompts[0];
  const easy = { ...base, id: 'easy-one', level: 'easy' };
  const hard = { ...base, id: 'hard-one' };
  const make = (difficulty) => { const r = new Room('T', 'k', new Database({ prompts: [easy, hard, db.prompts[1]] })); r.difficulty = difficulty; return r; };
  for (let i = 0; i < 6; i++) assert.equal(make('casual').pickPrompt(false).id, 'easy-one');
  for (let i = 0; i < 6; i++) assert.equal(make('zebra').pickPrompt(false).id, 'hard-one');
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(make('standard').pickPrompt(false).id);
  assert.deepEqual([...seen].sort(), ['easy-one', 'hard-one']);
  // no easy prompts at all: casual falls back to whatever exists
  const noEasy = new Room('T', 'k', new Database({ prompts: [hard, db.prompts[1]] })); noEasy.difficulty = 'casual';
  assert.equal(noEasy.pickPrompt(false).id, 'hard-one');
});
