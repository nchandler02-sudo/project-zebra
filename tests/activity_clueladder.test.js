'use strict';
// Clue Ladder activity: data validation, matcher round trips, and a full 5-case run over real WebSockets.
process.env.PORT = '3914';
process.env.ZEBRA_BANK_KEY = 'k';
process.env.ZEBRA_CLUE_MS = '1200';
process.env.ZEBRA_REVEAL_MS = '60000';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createServer } = require('../server/index');
const { PromptMatcher } = require('../server/matcher');
const { validate } = require('../tools/validate/validate_clues');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'clue_cases.json'), 'utf8'));
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_db.json'), 'utf8'));
const POINTS = [10, 7, 4, 2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const c = { ws, inbox: [], waiters: [], last: null, hostState: null };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === 'p_state') c.last = m;
    if (m.t === 'host_state') c.hostState = m;
    c.inbox.push(m);
    for (const w of [...c.waiters]) if (w.pred(m)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(m); }
  });
  c.open = () => new Promise((r) => ws.on('open', r));
  c.send = (o) => ws.send(JSON.stringify(o));
  c.next = (pred, ms = 8000) => new Promise((resolve, reject) => {
    const hit = c.inbox.find(pred);
    if (hit) { c.inbox.splice(c.inbox.indexOf(hit), 1); return resolve(hit); }
    const w = { pred, resolve: (m) => { clearTimeout(t); c.inbox.splice(c.inbox.indexOf(m), 1); resolve(m); } };
    const t = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
    c.waiters.push(w);
  });
  // Poll the latest activity view (phone) or host activity view until pred is true.
  c.until = async (pred, ms = 9000, host = false) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = host ? (c.hostState && c.hostState.activity) : (c.last && c.last.activity);
      if (v && pred(v)) return v;
      if (Date.now() > end) throw new Error('timeout waiting for view; last=' + JSON.stringify(v));
      await sleep(25);
    }
  };
  c.guess = async (text, raw) => {
    c.inbox.length = 0;
    c.send({ t: 'act', d: raw !== undefined ? raw : { k: 'guess', text } });
    const m = await c.next((x) => x.t === 'act_ack', 3000);
    return m.d;
  };
  return c;
}

const caseOf = (view) => DATA.cases.find((c) => c.clues[0] === view.clues[0]);

test('data file validates', () => {
  const res = validate(DATA);
  assert.deepEqual(res.errors, []);
  assert.ok(res.count >= 40, 'at least 40 cases, got ' + res.count);
  assert.equal(DATA.version, 1);
  assert.equal(DATA.review_status, 'unreviewed');
});

test('every diagnosis and alias matches itself, nothing else', () => {
  for (const c of DATA.cases) {
    const m = new PromptMatcher({ answers: [{ name: c.diagnosis, aliases: c.aliases }] });
    for (const n of [c.diagnosis, ...c.aliases]) {
      const r = m.match(n);
      assert.ok(r.matched && r.index === 0, `${c.id}: "${n}" should match (${r.method})`);
    }
    for (const w of c.common_wrong) assert.ok(!m.match(w).matched, `${c.id}: wrong "${w}" must not match`);
    // lowercase and a single dropped-letter typo of the diagnosis still matches when it is long enough
    assert.ok(m.match(c.diagnosis.toUpperCase()).matched);
  }
});

test('full 5-case run with 3 bots, late joiner and invalid input', async (t) => {
  const { server, game } = createServer(db, { questions: [] }, { bankKey: 'k' });
  await new Promise((r) => server.listen(3914, '127.0.0.1', r));
  t.after(() => { for (const c of server.wsClients) c.terminate(); server.closeAllConnections(); server.close(); game.stop(); });

  const origMatch = PromptMatcher.prototype.match;
  PromptMatcher.prototype.match = function (text) {
    if (String(text).trim().toLowerCase() === 'ambig') return { matched: false, index: -1, method: 'ambiguous', similarity: 0.9, normalized: 'ambig' };
    return origMatch.call(this, text);
  };
  t.after(() => { PromptMatcher.prototype.match = origMatch; });

  const host = client(3914); await host.open();
  host.send({ t: 'host_create' });
  const hosted = await host.next((m) => m.t === 'hosted');
  const join = async (name) => {
    const c = client(3914); await c.open();
    c.send({ t: 'join', code: hosted.code, name });
    const w = await c.next((m) => m.t === 'welcome');
    c.pid = w.pid;
    return c;
  };
  const A = await join('Ada'); const B = await join('Bo'); const C = await join('Cy');
  await sleep(100);

  host.send({ t: 'start_activity', type: 'clueladder' });
  let hv = await host.until((v) => v.type === 'clueladder' && v.stage === 'play', 4000, true);
  assert.equal(hv.caseNo, 1);
  assert.equal(hv.total, 5);
  assert.equal(hv.clues.length, 1);
  assert.ok(hv.endsInMs > 0 && hv.endsInMs <= 1200);
  assert.equal(hv.playerCount, 3);
  assert.ok(!('diagnosis' in hv), 'host play view must not leak the diagnosis');
  const seenIds = [];

  // ---------- case 1: A solves at clue 1 with a misspelling, B and C guess wrong ('lupus' x2 => common wrong)
  let v = await A.until((x) => x.stage === 'play' && x.caseNo === 1);
  assert.equal(v.status, 'guessing');
  assert.equal(v.guessesLeft, 3);
  assert.ok(!JSON.stringify(v).includes('diagnosis'), 'phone play view must not leak the diagnosis');
  let c1 = caseOf(v); seenIds.push(c1.id);
  const typo = c1.diagnosis.length > 6 ? c1.diagnosis.slice(0, 3) + c1.diagnosis.slice(4) : c1.diagnosis; // drop one letter
  const typoOk = new PromptMatcher({ answers: [{ name: c1.diagnosis, aliases: c1.aliases }] }).match(typo).matched;
  let ack = await A.guess(typoOk ? typo : c1.diagnosis);
  assert.equal(ack.ok, true); assert.equal(ack.correct, true);
  assert.equal(ack.points, POINTS[ack.clue - 1]);
  const a1 = ack.points;
  ack = await B.guess('lupus'); assert.deepEqual([ack.ok, ack.correct, ack.left], [true, false, 2]);
  ack = await B.guess('Lupus'); assert.equal(ack.ok, false, 'repeat guess is rejected'); // same normalized string
  ack = await C.guess('  LUPUS  '); assert.deepEqual([ack.ok, ack.correct, ack.left], [true, false, 2]);
  ack = await A.guess(c1.diagnosis); assert.equal(ack.ok, false, 'solved player cannot guess again');
  await sleep(100);
  hv = await host.until((x) => x.stage === 'play', 3000, true);
  assert.equal(hv.solved, 1);
  assert.equal(hv.guessing, 2);
  host.send({ t: 'act_host', cmd: 'next' });
  hv = await host.until((x) => x.stage === 'reveal', 3000, true);
  assert.equal(hv.diagnosis, c1.diagnosis);
  assert.equal(hv.clues.length, 4);
  assert.ok(hv.teaching.length > 5);
  assert.deepEqual(hv.solvers.map((s) => s.name), ['Ada']);
  assert.deepEqual(hv.commonWrong, [{ guess: 'lupus', count: 2 }]);
  const pa = await A.until((x) => x.stage === 'reveal');
  assert.equal(pa.status, 'solved'); assert.equal(pa.solvedPts, a1); assert.equal(pa.diagnosis, c1.diagnosis);
  assert.equal((await B.until((x) => x.stage === 'reveal')).status, 'guessing');

  // ---------- case 2: clue index advances on its own; B solves later (worth less), A runs out of guesses, offensive guess hidden
  host.send({ t: 'act_host', cmd: 'next' });
  hv = await host.until((x) => x.stage === 'play' && x.caseNo === 2, 3000, true);
  v = await B.until((x) => x.stage === 'play' && x.caseNo === 2);
  const c2 = caseOf(v); seenIds.push(c2.id);
  assert.ok(c2.id !== c1.id);
  ack = await A.guess('shit'); assert.equal(ack.left, 2);
  ack = await C.guess('shit'); assert.equal(ack.left, 2);
  ack = await A.guess('zzzz one'); assert.equal(ack.left, 1);
  ack = await A.guess('zzzz two'); assert.deepEqual([ack.correct, ack.left], [false, 0]);
  ack = await A.guess('zzzz three'); assert.equal(ack.ok, false, 'out of guesses');
  assert.equal((await A.until((x) => x.caseNo === 2 && x.status === 'out')).status, 'out');
  v = await B.until((x) => x.stage === 'play' && x.clueIndex >= 1 && x.caseNo === 2, 6000);
  assert.equal(v.clues.length, v.clueIndex + 1);
  ack = await B.guess(c2.aliases[0]);
  assert.equal(ack.correct, true);
  assert.ok(ack.points <= 7 && ack.points === POINTS[ack.clue - 1], 'later clue pays less');
  const b2 = ack.points;
  ack = await C.guess('ambig'); assert.deepEqual([ack.ok, ack.ambiguous, ack.left], [true, true, 2]);
  host.send({ t: 'act_host', cmd: 'next' });
  hv = await host.until((x) => x.stage === 'reveal', 3000, true);
  assert.deepEqual(hv.commonWrong, [], 'offensive and single wrong guesses are hidden');
  assert.deepEqual(hv.solvers.map((s) => s.name), ['Bo']);

  // ---------- case 3: late joiner; everyone solved => automatic reveal
  host.send({ t: 'act_host', cmd: 'next' });
  await host.until((x) => x.stage === 'play' && x.caseNo === 3, 3000, true);
  const D = await join('Di');
  v = await D.until((x) => x.type === 'clueladder' && x.stage === 'play' && x.caseNo === 3);
  assert.equal(v.status, 'guessing');
  const c3 = caseOf(v); seenIds.push(c3.id);
  ack = await D.guess(c3.diagnosis.toLowerCase()); assert.equal(ack.correct, true);
  await sleep(150);
  assert.ok((await host.until((x) => x.stage === 'play', 2000, true)).solved >= 1);
  // invalid input
  ack = await A.guess(null, { k: 'guess', text: 12345 }); assert.equal(ack.ok, false);
  ack = await A.guess(null, { k: 'guess', text: 'x'.repeat(81) }); assert.equal(ack.ok, false);
  ack = await A.guess(null, { k: 'guess', text: '   ' }); assert.equal(ack.ok, false);
  ack = await A.guess(null, { k: 'other', text: 'x' }); assert.equal(ack.ok, false);
  ack = await A.guess(null, 'not an object'); assert.equal(ack.ok, false);
  ack = await A.guess(null, { k: 'guess', text: { toString: 'x' } }); assert.equal(ack.ok, false);
  host.send({ t: 'act_host', cmd: 'bogus', d: 7 });
  host.send({ t: 'act', d: { k: 'guess', text: 'x' } }); // host is not a player: ignored
  await sleep(100);
  assert.equal((await A.until((x) => x.caseNo === 3)).guessesLeft, 3, 'invalid input never costs a guess');
  for (const p of [A, B, C]) { const a = await p.guess(c3.diagnosis); assert.equal(a.correct, true); }
  hv = await host.until((x) => x.stage === 'reveal', 3000, true);
  assert.equal(hv.solvers.length, 4);
  assert.equal(hv.moreSolvers, 0);
  // a guess during reveal is refused
  ack = await A.guess('anything'); assert.equal(ack.ok, false);

  // ---------- case 4: nobody answers; the clues reveal on a timer and the case ends by itself
  host.send({ t: 'act_host', cmd: 'next' });
  v = await A.until((x) => x.stage === 'play' && x.caseNo === 4);
  const c4 = caseOf(v); seenIds.push(c4.id);
  const seenIdx = new Set();
  const end = Date.now() + 9000;
  while (Date.now() < end) {
    const x = A.last && A.last.activity;
    if (x && x.stage === 'play') { seenIdx.add(x.clueIndex); assert.equal(x.clues.length, x.clueIndex + 1); }
    if (x && x.stage === 'reveal') break;
    await sleep(40);
  }
  assert.deepEqual([...seenIdx].sort(), [0, 1, 2, 3], 'all four clue indexes appeared');
  hv = await host.until((x) => x.stage === 'reveal', 2000, true);
  assert.equal(hv.diagnosis, c4.diagnosis);
  assert.deepEqual(hv.solvers, []);
  assert.ok(hv.endsInMs > 50000);

  // ---------- case 5: C solves at the last clue; then 'next' ends the run
  host.send({ t: 'act_host', cmd: 'next' });
  v = await C.until((x) => x.stage === 'play' && x.caseNo === 5);
  const c5 = caseOf(v); seenIds.push(c5.id);
  v = await C.until((x) => x.stage === 'play' && x.clueIndex === 3 && x.caseNo === 5, 6000);
  ack = await C.guess(c5.diagnosis); assert.deepEqual([ack.correct, ack.points], [true, 2]);
  host.send({ t: 'act_host', cmd: 'next' });
  hv = await host.until((x) => x.stage === 'reveal' && x.caseNo === 5, 3000, true);
  assert.equal(hv.lastCase, true);
  host.send({ t: 'act_host', cmd: 'next' });
  hv = await host.until((x) => x.stage === 'done', 3000, true);
  assert.equal(hv.finished, true);
  assert.equal(new Set(seenIds).size, 5, 'no repeated cases in a run');
  assert.ok(hv.top.length <= 5);
  assert.equal(hv.top[0].score >= hv.top[hv.top.length - 1].score, true);
  const pd = await A.until((x) => x.stage === 'done');
  assert.ok(pd.rank >= 1 && pd.rank <= 4);
  assert.ok(pd.myScore >= a1);
  const pdD = await D.until((x) => x.stage === 'done');
  assert.ok(pdD.myScore >= POINTS[3]);
  // leaderboard points were awarded through room.addScore
  const room = [...game.rooms.values()][0];
  assert.ok(room.players.get(A.pid).score >= a1);

  // a second run in the same room avoids the cases just played
  host.send({ t: 'end_activity' });
  await sleep(150);
  host.send({ t: 'start_activity', type: 'clueladder' });
  hv = await host.until((x) => x.type === 'clueladder' && x.stage === 'play', 3000, true);
  const fresh = await A.until((x) => x.stage === 'play' && x.caseNo === 1);
  assert.ok(!seenIds.includes(caseOf(fresh).id), 'new run does not repeat earlier cases in this room');
});
