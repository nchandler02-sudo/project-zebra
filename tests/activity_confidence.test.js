'use strict';
process.env.PORT = '3911';
process.env.ZEBRA_BANK_KEY = 'k';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createServer } = require('../server/index');

const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_db.json'), 'utf8'));
const mc = {
  questions: Array.from({ length: 30 }, (_, i) => ({
    id: `q${i}`, q: `Question ${i}?`, correct: `RIGHT ${i}`, wrong: [`wrong a${i}`, `wrong b${i}`, `wrong c${i}`], why: `Because ${i}.`, tags: [],
  })),
};

function client() {
  const ws = new WebSocket('ws://127.0.0.1:3911/ws');
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
      const t = setTimeout(() => reject(new Error('timeout waiting for message ' + pred)), ms);
      waiters.push(w);
    }),
    // wait for a fresh message matching pred, ignoring stale inbox content
    fresh: function (pred, ms = 8000) { this.inbox.length = 0; return this.next(pred, ms); },
  };
}

const act = (m) => m.t === 'p_state' && m.activity;
const hostAct = (m) => m.t === 'host_state' && m.activity;

test('confidence bets: full 10-question game', { timeout: 120000 }, async (t) => {
  const { server, game } = createServer(db, mc, { bankKey: 'k' });
  await new Promise((r) => server.listen(3911, '127.0.0.1', r));
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
  const A = await join('Ada'), B = await join('Bo'), C = await join('Cy'); // Cy never answers
  const room = [...game.rooms.values()][0];

  host.send({ t: 'start_activity', type: 'confidence' });
  let hv = (await host.next((m) => hostAct(m) && m.activity.type === 'confidence')).activity;
  assert.equal(hv.stage, 'ask');
  assert.equal(hv.total, 10);
  assert.equal(hv.options.length, 4);
  assert.equal(hv.correct, undefined, 'correct index hidden during ask');

  const ids = new Set();
  let late = null;
  const lastView = async (c, pred) => (await c.next((m) => act(m) && pred(m.activity), 8000)).activity;

  for (let n = 1; n <= 10; n++) {
    await new Promise((r) => setTimeout(r, 700)); // stay under the server's flood bucket
    let pv = await lastView(A, (a) => a.stage === 'ask' && a.n === n);
    assert.equal(pv.correct, undefined);
    assert.equal(pv.options.length, 4);
    const rightIdx = pv.options.findIndex((o) => o.startsWith('RIGHT'));
    ids.add(pv.q);

    if (n === 1) {
      // invalid inputs are rejected and do not lock
      for (const bad of [{ a: 'lock', pick: 4, stake: 3 }, { a: 'lock', pick: -1, stake: 3 }, { a: 'lock', pick: 1.5, stake: 3 },
        { a: 'lock', pick: 1, stake: 0 }, { a: 'lock', pick: 1, stake: 6 }, { a: 'lock', pick: '1', stake: 3 }, { a: 'lock' }, { a: 'nope' }]) {
        A.inbox.length = 0;
        await new Promise((r) => setTimeout(r, 200));
        A.send({ t: 'act', d: bad });
        const ack = await A.next((m) => m.t === 'act_ack');
        assert.equal(ack.d.ok, false);
      }
      for (const junk of [null, 'x', 5, []]) { await new Promise((r) => setTimeout(r, 200)); A.send({ t: 'act', d: junk }); } // must not crash or lock
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(room.activity.answers.size, 0);
    }
    if (n === 2) {
      // late joiner sees the current stage
      late = await join('Late');
      const lv = await lastView(late, (a) => a.stage === 'ask');
      assert.equal(lv.n, 2);
    }

    // Ada: right at stake 5 (n odd) or wrong at stake 5 (n even); Bo: right stake 1
    const adaPick = n % 2 ? rightIdx : (rightIdx + 1) % 4;
    A.inbox.length = 0;
    A.send({ t: 'act', d: { a: 'lock', pick: adaPick, stake: 5 } });
    assert.equal((await A.next((m) => m.t === 'act_ack')).d.ok, true);
    B.send({ t: 'act', d: { a: 'lock', pick: rightIdx, stake: 1 } });
    // double lock-in is refused
    A.inbox.length = 0;
    A.send({ t: 'act', d: { a: 'lock', pick: rightIdx, stake: 1 } });
    assert.equal((await A.next((m) => m.t === 'act_ack')).d.ok, false);
    if (n === 2) late.send({ t: 'act', d: { a: 'lock', pick: rightIdx, stake: 3 } });

    if (n === 3) {
      // Cy never answers: stage must stay in ask until the 25 s deadline
      await new Promise((r) => setTimeout(r, 1500));
      assert.equal(room.activity.stage, 'ask');
      // the host can force the reveal; everyone else already locked
      host.send({ t: 'act_host', cmd: 'next' });
    }
    // else: host next forces reveal quickly (Cy is silent, would otherwise wait 25 s)
    else host.send({ t: 'act_host', cmd: 'next' });

    const rv = await lastView(A, (a) => a.stage === 'reveal' && a.n === n);
    assert.equal(rv.correct, rightIdx);
    assert.equal(rv.result, n % 2 ? 'right' : 'wrong');
    assert.equal(rv.pts, n % 2 ? 10 : -14);
    const cv = await lastView(C, (a) => a.stage === 'reveal' && a.n === n);
    assert.equal(cv.result, 'none');
    assert.equal(cv.pts, 0);

    // stage checks: locking in during reveal is refused
    A.inbox.length = 0;
    A.send({ t: 'act', d: { a: 'lock', pick: 0, stake: 2 } });
    assert.equal((await A.next((m) => m.t === 'act_ack')).d.ok, false);

    const hrv = (await host.next((m) => hostAct(m) && m.activity.stage === 'reveal' && m.activity.n === n)).activity;
    assert.equal(hrv.byStake.length, 5);
    assert.ok(hrv.why);

    host.send({ t: 'act_host', cmd: 'next' });
  }

  assert.equal(ids.size, 10, 'no repeated questions');
  const fin = (await host.next((m) => hostAct(m) && m.activity.stage === 'done')).activity;
  assert.equal(fin.curve.length, 5);
  assert.equal(fin.curve[4].n, 10);
  assert.equal(fin.curve[4].pct, 50);
  assert.ok(/overconfident/.test(fin.takeaway), fin.takeaway);
  assert.ok(fin.top.length >= 3);
  assert.equal(fin.best.name, 'Ada');
  assert.equal(room.activity.finished, true);
  // Ada: 5 right (+50), 5 wrong (-70) = -20; Bo: +20
  const players = Object.fromEntries([...room.players.values()].map((p) => [p.name, p.score]));
  assert.equal(players.Ada, -20);
  assert.equal(players.Bo, 20 + 0);
  assert.equal(players.Cy, 0);
  const done = await lastView(B, (a) => a.stage === 'done');
  assert.equal(done.byStake[0].n, 10);
  assert.ok(done.coaching.length > 5);
  assert.equal(done.rank, 1);
  assert.equal(done.score, 20 + 0);
  assert.ok(room.usedConfidence.size === 10);
});
