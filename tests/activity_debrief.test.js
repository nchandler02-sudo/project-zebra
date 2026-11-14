'use strict';
process.env.PORT = '3913';
process.env.ZEBRA_BANK_KEY = 'k';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createServer } = require('../server/index');
const { validate } = require('../tools/validate/validate_debrief');
const Debrief = require('../server/activities/debrief');

const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_db.json'), 'utf8'));
const PORT = 3913;
let _game = null; let _code = null;
const room = () => _game.rooms.get(_code);

function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const inbox = [];
  const all = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m); all.push(d.toString());
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  return {
    ws, all,
    open: () => new Promise((r) => ws.on('open', r)),
    send: (o) => ws.send(JSON.stringify(o)),
    next: (pred, ms = 5000) => new Promise((resolve, reject) => {
      const hit = inbox.find(pred);
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return resolve(hit); }
      const w = { pred, resolve: (m) => { clearTimeout(t); inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
      const t = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      waiters.push(w);
    }),
    last: (pred) => { for (let i = inbox.length - 1; i >= 0; i--) if (pred(inbox[i])) return inbox[i]; return null; },
  };
}

test('data file validates', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'debrief_prompts.json'), 'utf8'));
  assert.deepEqual(validate(data), []);
  assert.ok(data.prompts.length >= 30);
  assert.deepEqual(validate({ version: 1, review_status: 'x', generator: 'y', prompts: [{ id: 'a' }] }).length > 0, true);
});

test('word cloud and filter helpers', () => {
  const { wordCloud, isProfane, cleanText } = Debrief._internals;
  const w = wordCloud(['We anchored on the first answer.', 'Anchors are sticky, answers too!', 'the and of']);
  const map = Object.fromEntries(w.map((x) => [x.w, x.n]));
  assert.equal(map.answer, 2); // answers merged with answer
  assert.equal(map.the, undefined);
  assert.ok(!('and' in map));
  assert.equal(isProfane('what the f.u.c.k'), true);
  assert.equal(isProfane('Scunthorpe classic assess'), false);
  assert.equal(cleanText('  a\u0000b\n\tc  ' + 'x'.repeat(200)).length, 100);
  assert.ok(!/[\u0000-\u001f]/.test(cleanText('a\u0000b\u0007c')));
});

test('debrief flow: prompt -> cloud -> next -> done, anonymous', async (t) => {
  const { server, game } = createServer(db, { questions: [] }, {});
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  t.after(() => { for (const c of server.wsClients) c.terminate(); server.closeAllConnections(); server.close(); game.stop(); });

  const host = client(); await host.open();
  host.send({ t: 'host_create' });
  const hosted = await host.next((m) => m.t === 'hosted');
  _game = game; _code = hosted.code;
  const join = async (name) => {
    const c = client(); await c.open();
    c.send({ t: 'join', code: hosted.code, name });
    const w = await c.next((m) => m.t === 'welcome');
    return { c, id: w.pid, name };
  };
  const A = await join('Zorblat Aardvark');
  const B = await join('Quimby Longname');
  const C = await join('Xylia Notmalicious');
  const players = [A, B, C];

  host.send({ t: 'start_activity', type: 'debrief' });
  let hs = await host.next((m) => m.t === 'host_state' && m.activity && m.activity.type === 'debrief' && m.activity.stage === 'prompt');
  assert.equal(hs.activity.responded, 0);
  assert.ok(hs.activity.endsInMs > 80000 && hs.activity.endsInMs <= 90000);
  const firstPrompt = hs.activity.prompt;

  const pstate = async (p, pred = () => true) => (await p.c.next((m) => m.t === 'p_state' && m.activity && pred(m.activity))).activity;
  let av = await pstate(A, (a) => a.stage === 'prompt');
  assert.ok(av.tags.length >= 4);
  assert.equal(av.mine, null);

  const ackOf = (p) => p.c.next((m) => m.t === 'act_ack');
  const score = () => room().players.get(A.id || [...room().players.keys()][0]);

  // invalid inputs
  A.c.send({ t: 'act', d: { t: 'respond', tags: [99] } });
  assert.equal((await ackOf(A)).d.ok, false);
  A.c.send({ t: 'act', d: { t: 'respond', tags: [0, 1, 2] } });
  assert.equal((await ackOf(A)).d.ok, false);
  A.c.send({ t: 'act', d: { t: 'respond', tags: ['0'] } });
  assert.equal((await ackOf(A)).d.ok, false);
  A.c.send({ t: 'act', d: { t: 'respond', tags: [-1] } });
  assert.equal((await ackOf(A)).d.ok, false);
  A.c.send({ t: 'act', d: { t: 'respond', text: 42 } });
  assert.equal((await ackOf(A)).d.ok, false);
  A.c.send({ t: 'act', d: { t: 'respond', tags: [], text: '   ' } });
  assert.equal((await ackOf(A)).d.ok, false);
  A.c.send({ t: 'act', d: 'garbage' });
  assert.equal((await ackOf(A)).d.ok, false);
  A.c.send({ t: 'act', d: { t: 'respond', tags: [0], text: 'a'.repeat(5) } }); // valid
  assert.equal((await ackOf(A)).d.ok, true);

  const pids = [...room().players.keys()];
  const scoreOf = (i) => room().players.get(pids[i]).score;
  const s0 = scoreOf(0);
  assert.equal(s0, 5);

  // update response: no second award
  A.c.send({ t: 'act', d: { t: 'respond', tags: [1, 1], text: 'We anchored on the first answer\u0000 and answers\n' + 'z'.repeat(300) } });
  const upd = await ackOf(A);
  assert.equal(upd.d.ok, true);
  assert.deepEqual(upd.d.tags, [1]);
  assert.equal(upd.d.text.length, 100);
  assert.ok(!/[\u0000-\u001f]/.test(upd.d.text));
  assert.equal(scoreOf(0), 5);

  // B: profane text (counts, but filtered out of cloud and quotes)
  B.c.send({ t: 'act', d: { t: 'respond', tags: [1, 2], text: 'what a bullshit anchored answer' } });
  assert.equal((await ackOf(B)).d.ok, true);
  assert.equal(scoreOf(1), 5);

  // C: good quote
  C.c.send({ t: 'act', d: { t: 'respond', tags: [2], text: 'We should slow down and anchored less' } });
  assert.equal((await ackOf(C)).d.ok, true);

  // late joiner
  const D = await join('Lateson Johnson');
  await pstate(D, (a) => a.stage === 'prompt' && a.mine === null);
  D.c.send({ t: 'act', d: { t: 'respond', tags: [3], text: 'ok' } }); // short: kept as a response, dropped as a quote
  assert.equal((await ackOf(D)).d.ok, true);
  players.push(D);
  assert.equal(room().players.get([...room().players.keys()][3]).score, 5);

  hs = await host.next((m) => m.t === 'host_state' && m.activity && m.activity.stage === 'prompt' && m.activity.responded === 4);
  assert.equal(hs.activity.words, undefined);

  // host close -> cloud
  host.send({ t: 'act_host', cmd: 'close' });
  hs = await host.next((m) => m.t === 'host_state' && m.activity && m.activity.stage === 'cloud');
  const act = hs.activity;
  const words = Object.fromEntries(act.words.map((w) => [w.w, w.n]));
  assert.equal(words.anchored, 2); // A's update + C (B filtered, profane)
  assert.ok(!('bullshit' in words));
  assert.equal(act.bars.length >= 4, true);
  assert.equal(act.bars[1].count, 2); // A updated to [1], B chose 1
  assert.equal(act.bars[0].count, 0); // A's first answer was replaced
  assert.ok(act.teaching.length > 40);
  assert.equal(act.quotesOn, true);
  assert.ok(act.quotes.length >= 1 && act.quotes.length <= 6);
  for (const q of act.quotes) { assert.ok(q.text.length >= 4); assert.ok(!/bullshit/i.test(q.text)); assert.ok(q.text !== 'ok'); }

  // phone cloud view: teaching + earned, no other players' text
  const ac = await pstate(A, (a) => a.stage === 'cloud');
  assert.equal(ac.earned, 5);
  assert.ok(ac.teaching);
  assert.equal(ac.quotes, undefined);

  // late response after close is refused
  D.c.send({ t: 'act', d: { t: 'respond', tags: [0] } });
  assert.equal((await ackOf(D)).d.ok, false);

  // hide + quotes toggle
  const qi = act.quotes[0].i;
  host.send({ t: 'act_host', cmd: 'hide', d: { i: qi } });
  hs = await host.next((m) => m.t === 'host_state' && m.activity && m.activity.stage === 'cloud' && !m.activity.quotes.some((q) => q.i === qi));
  host.send({ t: 'act_host', cmd: 'hide', d: { i: 'x' } }); // ignored
  host.send({ t: 'act_host', cmd: 'quotes' });
  hs = await host.next((m) => m.t === 'host_state' && m.activity && m.activity.stage === 'cloud' && m.activity.quotesOn === false);
  assert.deepEqual(hs.activity.quotes, []);
  host.send({ t: 'act_host', cmd: 'quotes' });
  await host.next((m) => m.t === 'host_state' && m.activity && m.activity.quotesOn === true);

  // players cannot send host commands
  A.c.send({ t: 'act_host', cmd: 'done' });

  // next prompt: a different one, state reset
  host.send({ t: 'act_host', cmd: 'next' });
  hs = await host.next((m) => m.t === 'host_state' && m.activity && m.activity.stage === 'prompt' && m.activity.prompt !== firstPrompt);
  assert.equal(hs.activity.responded, 0);
  const av2 = await pstate(A, (a) => a.stage === 'prompt' && a.prompt !== firstPrompt);
  assert.equal(av2.mine, null);
  A.c.send({ t: 'act', d: { t: 'respond', tags: [0] } });
  assert.equal((await ackOf(A)).d.ok, true);
  assert.equal(scoreOf(0), 10); // +5 once per prompt

  // done
  host.send({ t: 'act_host', cmd: 'done' });
  hs = await host.next((m) => m.t === 'host_state' && m.activity && m.activity.stage === 'done');
  assert.equal(hs.activity.finished, true);
  assert.match(hs.activity.summary, /Most common reflections: .+\(\d+\)/);
  assert.equal(hs.activity.promptsRun, 2);
  const dv = await pstate(B, (a) => a.stage === 'done');
  assert.ok(dv.summary);

  // anonymity: no player names or ids ever appear in anything the host or other phones received about the activity
  const strip = (raw) => { const m = JSON.parse(raw); return JSON.stringify(m.activity || m.d || null); };
  const idsAndNames = (excludeIdx) => [...room().players.values()].map((p, i) => ({ i, id: p.id, name: p.name })).filter((x) => x.i !== excludeIdx);
  for (let pi = 0; pi < players.length; pi++) {
    const mine = players[pi];
    const seen = mine.c.all.map((r) => { const m = JSON.parse(r); return m.t === 'p_state' || m.t === 'act_ack' ? JSON.stringify(m.activity || m.d || null) : ''; }).join('|');
    for (const o of idsAndNames(pi)) {
      assert.ok(!seen.includes(o.name), `phone ${pi} saw name ${o.name} in activity data`);
      assert.ok(!seen.includes('"' + o.id + '"'), `phone ${pi} saw id ${o.id} in activity data`);
    }
  }
  const hostSeen = host.all.map((r) => { const m = JSON.parse(r); return m.t === 'host_state' ? JSON.stringify(m.activity || null) : ''; }).join('|');
  for (const p of room().players.values()) {
    assert.ok(!hostSeen.includes(p.name), 'host activity view leaked a name');
    assert.ok(!hostSeen.includes('"' + p.id + '"'), 'host activity view leaked an id');
  }
  void strip;
});

test('prompt deadline moves to the cloud and prompts do not repeat', async () => {
  const room = { players: new Map([['p1', { id: 'p1', name: 'N', connected: true, score: 0 }]]), addScore(pid, n) { this.players.get(pid).score += n; } };
  const act = new Debrief(room, {});
  const seen = new Set([act.current.id]);
  act.deadline = Date.now() - 1;
  assert.equal(act.tick(Date.now()), true);
  assert.equal(act.stage, 'cloud');
  for (let i = 0; i < 20; i++) { act.hostCommand('next'); assert.ok(!seen.has(act.current.id)); seen.add(act.current.id); }
  act.hostCommand('done');
  assert.equal(act.finished, true);
});
