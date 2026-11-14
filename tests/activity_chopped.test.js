'use strict';
process.env.PORT = '3916';
process.env.ZEBRA_BANK_KEY = 'k';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createServer } = require('../server/index');
const { PromptMatcher } = require('../server/matcher');
const Chopped = require('../server/activities/chopped');
const { validate } = require('../tools/validate/validate_chopped');

const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_db.json'), 'utf8'));
const mc = { questions: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  const ws = new WebSocket('ws://127.0.0.1:3916/ws');
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
  };
}

async function setup(t) {
  const { server, game } = createServer(db, mc, { bankKey: 'k' });
  await new Promise((r) => server.listen(3916, '127.0.0.1', r));
  t.after(() => { for (const c of server.wsClients) c.terminate(); server.closeAllConnections(); server.close(); game.stop(); });
  const host = client(); await host.open();
  host.send({ t: 'host_create' });
  const hosted = await host.next((m) => m.t === 'hosted');
  const join = async (name) => {
    const c = client(); await c.open();
    c.send({ t: 'join', code: hosted.code, name });
    await c.next((m) => m.t === 'welcome');
    return c;
  };
  const room = () => [...game.rooms.values()][0];
  const score = (name) => [...room().players.values()].find((p) => p.name === name).score;
  const waitFor = async (pred, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return; await sleep(40); } throw new Error('waitFor timed out'); };
  return { host, join, room, score, waitFor };
}

/** Submit entries and return the act_ack payload. Spaced out to stay under the server's flood bucket. */
async function submit(c, entries) {
  await sleep(250);
  c.inbox.length = 0;
  c.send({ t: 'act', d: { a: 'submit', entries } });
  return (await c.next((m) => m.t === 'act_ack')).d;
}

test('data file validates and every diagnosis/alias matches through PromptMatcher', () => {
  const r = validate();
  assert.deepEqual(r.errs, []);
  assert.ok(r.count >= 12);
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'chopped_cases.json'), 'utf8'));
  assert.equal(data.review_status, 'unreviewed');
  for (const c of data.cases) {
    const m = new PromptMatcher({ answers: c.differential.map((d) => ({ name: d.name, aliases: d.aliases })) });
    assert.deepEqual(m.collisions, [], c.id);
    const fi = c.differential.findIndex((d) => d.points === 5);
    for (const s of [c.diagnosis, ...c.aliases]) {
      const res = m.match(s);
      assert.ok(res.matched && res.index === fi, `${c.id}: "${s}" should match the final diagnosis`);
    }
    for (const st of c.stages) { const w = st.text.trim().split(/\s+/).length; assert.ok(w >= 25 && w <= 60, `${c.id} stage word count ${w}`); }
    assert.ok(c.differential.length >= 8 && c.differential.length <= 14);
  }
});

test('chopped: full case with 6 players, chop after stage 2, late joiner, invalid inputs', { timeout: 90000 }, async (t) => {
  const { host, join, room, score, waitFor } = await setup(t);
  const P = [];
  for (const n of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) P.push(await join(n));
  host.send({ t: 'start_activity', type: 'chopped', opts: { caseId: 'ch01' } });
  await waitFor(() => room().activity && room().activity.constructor.meta.type === 'chopped');
  const act = room().activity;
  assert.equal(act.stage, 'think');
  assert.equal(act.stageIdx, 0);
  const next = async (stage, idx) => { host.send({ t: 'act_host', cmd: 'next' }); await waitFor(() => act.stage === stage && (idx == null || act.stageIdx === idx)); };

  // views: nothing leaks during play
  const hv = act.hostView();
  assert.equal(hv.stages.length, 1);
  assert.ok(hv.endsInMs > 0 && hv.endsInMs <= 60000);
  assert.equal(hv.diagnosis, undefined);
  assert.equal(hv.differential, undefined);
  const wire = await P[0].next((m) => m.t === 'p_state' && m.activity && m.activity.type === 'chopped');
  assert.equal(wire.activity.diagnosis, undefined);
  assert.equal(wire.activity.stage, 'think');

  // invalid inputs
  for (const bad of [{ a: 'submit', entries: 'PE' }, { a: 'submit', entries: [{ x: 1 }] }, { a: 'submit' }, { a: 'nope' }, { a: 'submit', entries: { length: 1 } }]) {
    await sleep(250); P[0].inbox.length = 0; P[0].send({ t: 'act', d: bad });
    assert.equal((await P[0].next((m) => m.t === 'act_ack')).d.ok, false, JSON.stringify(bad));
  }
  await sleep(250); P[0].send({ t: 'act', d: null }); // must not crash
  const long = 'Pulmonary embolism ' + 'x'.repeat(200);
  const capped = await submit(P[0], [long]);
  assert.equal(capped.ok, true);
  assert.ok(capped.entries[0].length <= 80);
  assert.equal(act.subs.size, 1);
  const tooMany = await submit(P[0], ['a', 'b', 'c', 'd']);
  assert.deepEqual([tooMany.ok, tooMany.error], [false, 'too_many']);
  const nonStr = await submit(P[0], [5]);
  assert.equal(nonStr.ok, false);

  // stage 0: P1 early PE (3) + ACS (4) + bonus 3 = 10; P2 dup pneumonia + pericarditis = 5; the other four score 0 (tie, only 2 would remain: no chop)
  assert.equal((await submit(P[0], ['Pulmonary embolism', 'acute coronary syndrome'])).ok, true);
  await submit(P[1], ['pneumonia', 'Pneumonia ', 'pericarditis']);
  await submit(P[2], ['zzzzqqq']);
  assert.equal(act.hostView().submitted, 3);
  await next('result', 0);
  const r0 = act.hostView();
  assert.equal(r0.chop, null);
  assert.equal(act.alive().length, 6);
  assert.ok(r0.top.some((x) => x.name === 'Pneumonia' && x.count === 1), 'duplicate counted once');
  assert.equal(r0.other, 1);
  const cumOf = (i) => act.roster.get([...room().players.values()].find((p) => p.name === 'P' + (i + 1)).id).cum;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(cumOf), [10, 5, 0, 0, 0, 0]);

  // stage 1: late joiner arrives and can only watch
  await next('think', 1);
  const late = await join('Late');
  const lv = (await late.next((m) => m.t === 'p_state' && m.activity && m.activity.stage === 'think')).activity;
  assert.equal(lv.status, 'watching');
  const lateAck = await submit(late, ['PE']);
  assert.deepEqual([lateAck.ok, lateAck.error], [false, 'watching']);
  await submit(P[0], ['Pulmonary embolism']);
  await submit(P[1], ['PE', 'acute coronary syndrome']);
  await submit(P[2], ['pneumonia']);
  await submit(P[3], ['deep vein thrombosis']);
  await submit(P[3], ['DVT']); // revising keeps a single submission
  await submit(P[4], ['pneumothorax', 'PE']);
  await next('result', 1);
  const r1 = act.hostView();
  assert.deepEqual(r1.chop.map((c) => c.name), ['P6']);
  assert.equal(act.alive().length, 5);
  assert.deepEqual([0, 1, 2, 3, 4].map(cumOf), [15, 17, 3, 3, 12]);
  assert.equal(score('P6'), 0);
  const pv6 = act.playerView([...room().players.values()].find((p) => p.name === 'P6').id);
  assert.equal(pv6.status, 'chopped');
  assert.equal(pv6.justChopped, true);

  // stage 2: chopped P6 cannot submit; 5 survivors so the lowest (P3, 5) is chopped
  await next('think', 2);
  const chopAck = await submit(P[5], ['PE']);
  assert.deepEqual([chopAck.ok, chopAck.error], [false, 'chopped']);
  await submit(P[0], ['PE']);
  await submit(P[1], ['PE']);
  await submit(P[2], ['myocarditis']);
  await submit(P[3], ['PE']);
  await next('result', 2);
  assert.deepEqual(act.hostView().chop.map((c) => c.name), ['P3']);
  assert.equal(score('P3'), 5);
  assert.deepEqual([0, 1, 3, 4].map(cumOf), [20, 22, 8, 12]);

  // stage 3: no chop after the last stage; reveal pays survivors, champion +20
  await next('think', 3);
  await submit(P[0], ['PE']);
  await submit(P[1], ['PE']);
  await submit(P[4], ['PE']);
  await next('result', 3);
  assert.equal(act.hostView().chop, null);
  assert.equal(act.hostView().last, true);
  await next('reveal');
  const rv = act.hostView();
  assert.equal(rv.diagnosis, 'Pulmonary embolism');
  assert.equal(rv.differential.length, 9);
  assert.ok(rv.teaching.length > 50);
  assert.deepEqual(rv.best.map((b) => b.name).sort(), ['P1', 'P2', 'P4', 'P5']);
  assert.deepEqual(rv.best.find((b) => b.name === 'P1').score, 10);
  assert.deepEqual([score('P1'), score('P2'), score('P3'), score('P4'), score('P5'), score('P6'), score('Late')], [25, 47, 5, 8, 17, 0, 0]);
  await next('done');
  assert.equal(act.finished, true);
  const dv = act.hostView();
  assert.deepEqual(dv.ranking.map((r) => r.name), ['P2', 'P1', 'P5', 'P4']);
  assert.deepEqual(dv.chopList.map((c) => c.name).sort(), ['P3', 'P6']);
  assert.equal(dv.ranking[0].champion, true);
  // scores are paid once only
  assert.equal(score('P2'), 47);

  // host 'next' at the end starts another case
  host.send({ t: 'act_host', cmd: 'next' });
  await waitFor(() => act.stage === 'think' && act.finished === false);
  assert.equal(act.roster.size, 7); // all seven connected players are dealt in
  assert.notEqual(act.c.id, 'ch01');
});

test('chopped: a room of 3 never chops', { timeout: 60000 }, async (t) => {
  const { host, join, room, waitFor } = await setup(t);
  const A = await join('A'), B = await join('B'); await join('C');
  host.send({ t: 'start_activity', type: 'chopped', opts: { caseId: 'ch02' } });
  await waitFor(() => room().activity);
  const act = room().activity;
  const next = async (stage) => { host.send({ t: 'act_host', cmd: 'next' }); await waitFor(() => act.stage === stage); };
  for (let s = 0; s < 4; s++) {
    assert.equal(act.stageIdx, s);
    await submit(A, ['aortic dissection']);
    await submit(B, ['pneumonia']);
    await next('result');
    assert.equal(act.hostView().chop, null);
    assert.equal(act.alive().length, 3);
    if (s < 3) await next('think');
  }
  await next('reveal');
  assert.deepEqual(act.hostView().best.map((b) => b.name).sort(), ['A', 'B', 'C']);
});

// ---------- rule checks with a fake room ----------
function fakeRoom(n) {
  const players = new Map();
  for (let i = 1; i <= n; i++) players.set('p' + i, { id: 'p' + i, name: 'P' + i, connected: true, score: 0 });
  return { players, addScore(pid, pts) { players.get(pid).score += pts; } };
}
function drive(act, plan) { // plan: array per stage of {pid: [entries]}
  const out = [];
  for (let s = 0; s < plan.length; s++) {
    for (const [pid, e] of Object.entries(plan[s] || {})) assert.equal(act.handle({ id: pid }, { a: 'submit', entries: e }).ok, true);
    act.hostCommand('next'); // resolve
    out.push(act.chopNames);
    act.hostCommand('next');
  }
  return out;
}

test('chop rules: ties, minimum survivors, stage 3 threshold, small rooms', () => {
  // all tied at 0 with 6 players: tied group is everyone, nobody survives -> no chop
  let act = new Chopped(fakeRoom(6), { caseId: 'ch01' });
  assert.equal(drive(act, [{}])[0], null);

  // 4 players, one clear loser: chopped (3 remain)
  act = new Chopped(fakeRoom(4), { caseId: 'ch01' });
  assert.deepEqual(drive(act, [{ p1: ['PE'], p2: ['PE'], p3: ['PE'] }])[0].map((c) => c.name), ['P4']);

  // 4 players, two tied for last: chopping both would leave 2 -> no chop
  act = new Chopped(fakeRoom(4), { caseId: 'ch01' });
  assert.equal(drive(act, [{ p1: ['PE'], p2: ['PE'] }])[0], null);

  // 5 players, two tied for last leaving 3: both chopped
  act = new Chopped(fakeRoom(5), { caseId: 'ch01' });
  assert.deepEqual(drive(act, [{ p1: ['PE'], p2: ['PE'], p3: ['PE'] }])[0].map((c) => c.name).sort(), ['P4', 'P5']);

  // fewer than 4 connected: no chop even with a clear loser
  act = new Chopped(fakeRoom(3), { caseId: 'ch01' });
  assert.equal(drive(act, [{ p1: ['PE'], p2: ['PE'] }])[0], null);

  // 5 players, stage index 2 with only 4 survivors: no chop
  const room = fakeRoom(5);
  act = new Chopped(room, { caseId: 'ch01' });
  const res = drive(act, [{ p1: ['PE'], p2: ['PE'], p3: ['PE'], p4: ['PE'] }, { p1: ['PE'], p2: ['PE'], p3: ['PE'], p4: ['PE'] }, { p1: ['PE'], p2: ['PE'], p3: ['PE'] }]);
  assert.equal(res[0].length, 1); // p5 chopped after stage 1
  assert.equal(res[1], null); // p1-p4 tied, nobody left
  assert.equal(res[2], null); // 4 survivors < 5
  assert.equal(room.players.get('p5').score, 0);
});

test('scoring: half points for early guesses, must-not-miss bonus once, duplicates once', () => {
  const act = new Chopped(fakeRoom(2), { caseId: 'ch01' });
  const s = Chopped.scoreEntries(act.c, ['PE', 'pulmonary embolus', 'aortic dissection'], 0);
  assert.equal(s.score, 3 + 0 + 4 + 3);
  assert.equal(Chopped.scoreEntries(act.c, ['PE'], 1).score, 5);
  assert.equal(Chopped.scoreEntries(act.c, ['acute coronary syndrome', 'aortic dissection', 'pneumothorax'], 1).score, 12 + 3);
  assert.equal(Chopped.scoreEntries(act.c, ['nonsense words here'], 3).score, 0);
});
