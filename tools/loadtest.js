'use strict';
/**
 * Load test: one host plus N simulated phones in a single room.
 *   node tools/loadtest.js [wsUrl] [players]     e.g.  node tools/loadtest.js ws://localhost:3991/ws 500
 * Phases: join storm -> a round where everyone answers (with the lightning round on) -> reveal -> a Confidence Bets game.
 * Reports join success, how long state updates take to reach every phone, and server memory (from the host debug panel).
 */
const WebSocket = require('ws');

const URL = process.argv[2] || 'ws://localhost:3000/ws';
const N = Number(process.argv[3]) || 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };
const WORDS = ['sepsis', 'lupus', 'pulmonary embolism', 'amiodarone', 'hypercalcemia', 'sarcoidosis', 'zebra', 'tuberculosis', 'dka', 'adrenal insufficiency'];

function open(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 15000 });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

(async () => {
  const t0 = Date.now();
  const host = await open(URL);
  let code = null, hostState = null, debug = null;
  host.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'hosted') code = m.code;
    if (m.t === 'host_state') hostState = m;
    if (m.t === 'debug_info') debug = m;
  });
  host.send(JSON.stringify({ t: 'host_create' }));
  while (!code) await sleep(50);
  console.log(`room ${code} created; connecting ${N} players to ${URL}`);

  const players = [];
  let welcomed = 0, failed = 0;
  const lat = { round: [], reveal: [], activity: [] };
  const marks = { round: 0, reveal: 0, activity: 0 };
  let msgs = 0, bytes = 0;

  async function addPlayer(i) {
    try {
      const ws = await open(URL);
      const p = { ws, i, phase: '', q: null, answered: 0, mcAnswered: 0, seen: {}, act: null };
      ws.on('message', (d) => {
        msgs++; bytes += d.length;
        const m = JSON.parse(d);
        if (m.t === 'welcome') { welcomed++; }
        if (m.t === 'p_state') {
          const now = Date.now();
          if (m.phase === 'round' && marks.round && !p.seen.round) { p.seen.round = 1; lat.round.push(now - marks.round); }
          if (m.phase === 'reveal' && marks.reveal && !p.seen.reveal) { p.seen.reveal = 1; lat.reveal.push(now - marks.reveal); }
          if (m.phase === 'activity' && marks.activity && !p.seen.activity) { p.seen.activity = 1; lat.activity.push(now - marks.activity); }
          p.phase = m.phase;
          if (m.lightning && m.lightning.active && m.lightning.q && p.q !== m.lightning.q.id) {
            p.q = m.lightning.q.id;
            setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'mc_answer', qid: p.q, choice: Math.floor(Math.random() * 4) })), 200 + Math.random() * 1500);
          }
          if (m.phase === 'activity' && m.activity) {
            p.act = m.activity;
            if (m.activity.type === 'confidence' && m.activity.stage === 'ask' && p.lastQ !== m.activity.n) {
              p.lastQ = m.activity.n;
              setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'act', d: { a: 'lock', pick: Math.floor(Math.random() * 4), stake: 1 + Math.floor(Math.random() * 5) } })), 300 + Math.random() * 2500);
            }
          }
        }
      });
      ws.on('error', () => {});
      ws.send(JSON.stringify({ t: 'join', code, name: `Bot${i}` }));
      players.push(p);
    } catch (e) { failed++; }
  }

  // join storm: 40 new connections every 200 ms (a room filling up as people scan the QR code)
  const tJoin = Date.now();
  for (let i = 0; i < N; i += 40) {
    await Promise.all(Array.from({ length: Math.min(40, N - i) }, (_, k) => addPlayer(i + k)));
    await sleep(200);
  }
  const deadline = Date.now() + 20000;
  while (welcomed < N - failed && Date.now() < deadline) await sleep(100);
  console.log(`joined: ${welcomed}/${N} (connect failures ${failed}) in ${((Date.now() - tJoin) / 1000).toFixed(1)} s`);

  host.send(JSON.stringify({ t: 'debug' })); await sleep(500);
  const mem0 = debug ? debug.rssMB : null;

  // a round with everyone answering at the same time, lightning round on
  host.send(JSON.stringify({ t: 'set_options', lightning: true, difficulty: 'casual' })); await sleep(400);
  marks.round = Date.now();
  host.send(JSON.stringify({ t: 'start_round' }));
  await sleep(1500);
  const answerStart = Date.now();
  for (const p of players) {
    for (let k = 0; k < 3; k++) setTimeout(() => p.ws.readyState === 1 && p.ws.send(JSON.stringify({ t: 'answer', text: WORDS[(p.i + k) % WORDS.length] })), Math.random() * 3000 + k * 400);
  }
  await sleep(5000);
  host.send(JSON.stringify({ t: 'end_round' })); // skip to the lightning questions
  await sleep(6000);
  marks.reveal = Date.now();
  host.send(JSON.stringify({ t: 'end_round' })); // end the round
  await sleep(3000);
  const inReveal = players.filter((p) => p.phase === 'reveal').length;
  console.log(`round phase reached phones: ${lat.round.length}/${welcomed}; reveal reached: ${lat.reveal.length}/${welcomed} (phones showing reveal now: ${inReveal})`);

  host.send(JSON.stringify({ t: 'debug' })); await sleep(500);
  const mem1 = debug ? debug.rssMB : null;

  // an activity: Confidence Bets with everyone locking in within ~3 s
  marks.activity = Date.now();
  host.send(JSON.stringify({ t: 'start_activity', type: 'confidence' }));
  await sleep(7000);
  const inAct = players.filter((p) => p.phase === 'activity').length;
  console.log(`activity reached phones: ${lat.activity.length}/${welcomed}; phones in activity: ${inAct}`);
  host.send(JSON.stringify({ t: 'debug' })); await sleep(500);
  const mem2 = debug ? debug.rssMB : null;

  const fmt = (a) => (a.length ? `p50 ${pct(a, 50)} ms, p95 ${pct(a, 95)} ms, max ${Math.max(...a)} ms` : 'no data');
  console.log('--- results ---');
  console.log(`players joined        ${welcomed}/${N}`);
  console.log(`round start latency   ${fmt(lat.round)}`);
  console.log(`reveal latency        ${fmt(lat.reveal)}`);
  console.log(`activity start latency ${fmt(lat.activity)}`);
  console.log(`server memory (MB)    after join ${mem0}, after round ${mem1}, after activity ${mem2}`);
  console.log(`messages received by phones ${msgs} (${(bytes / 1048576).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(`sockets open: ${players.filter((p) => p.ws.readyState === 1).length}`);
  for (const p of players) try { p.ws.close(); } catch (e) { /* ignore */ }
  host.close();
  await sleep(500);
  process.exit(0);
})().catch((e) => { console.error('loadtest failed:', e.message); process.exit(1); });
