'use strict';
/**
 * Project Zebra server: static files + WebSocket on one port (so a single tunnel/URL serves everything).
 *   node server/index.js            (PORT=3000 by default, ZEBRA_DB=path to override the question DB)
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const { Game, tierFor, TIER_LABELS } = require('./game');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const QR_LIB = path.join(ROOT, 'node_modules', 'qrcode-generator', 'dist', 'qrcode.js');
const DB_PATH = process.env.ZEBRA_DB || path.join(ROOT, 'data', 'clinical_prompts_db.json');
const MC_PATH = process.env.ZEBRA_MC || path.join(ROOT, 'data', 'mc_questions.json');
const MAX_SOCKETS = 1200;
const BANK_KEY_PATH = path.join(ROOT, 'data', '.bank_key');

/** Secret for the question-bank page: ZEBRA_BANK_KEY, else a random key kept in data/.bank_key. */
function loadBankKey() {
  if (process.env.ZEBRA_BANK_KEY) return process.env.ZEBRA_BANK_KEY;
  try { const k = fs.readFileSync(BANK_KEY_PATH, 'utf8').trim(); if (k) return k; } catch { /* make one */ }
  const k = crypto.randomBytes(12).toString('hex');
  try { fs.writeFileSync(BANK_KEY_PATH, k + '\n', { mode: 0o600 }); } catch (e) { console.warn('[bank] could not save key:', e.message); }
  return k;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The whole question bank as one readable page: every prompt, answer, score, tier, alias and pearl. */
function bankPage(db, mc) {
  const prompts = db.prompts;
  const total = prompts.reduce((n, p) => n + p.answers.length, 0);
  const cats = new Map();
  for (const p of prompts) { if (!cats.has(p.category)) cats.set(p.category, []); cats.get(p.category).push(p); }
  let body = '';
  for (const [cat, ps] of cats) {
    body += `<h2>${esc(cat)}</h2>`;
    for (const p of ps) {
      const rows = [...p.answers].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map((a) => {
        const t = tierFor(a.score);
        return `<tr class="t-${t}"><td class="sc">${esc(a.score)}</td><td class="tr">${esc(TIER_LABELS[t])}</td><td class="nm">${esc(a.name)}</td><td class="al">${esc((a.aliases || []).join(', '))}</td><td class="pe">${esc(a.pearl || '')}</td></tr>`;
      }).join('');
      body += `<section id="${esc(p.id)}"><h3>${esc(p.prompt)}</h3><p class="meta"><code>${esc(p.id)}</code> &middot; ${esc(p.difficulty || '')}${p.level ? ' &middot; ' + esc(p.level) : ''} &middot; ${p.answers.length} answers</p><table><thead><tr><th>Points</th><th>Level</th><th>Answer</th><th>Also accepted</th><th>Pearl</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    }
  }
  let lightning = '';
  if (mc && Array.isArray(mc.questions || mc)) {
    const qs = mc.questions || mc;
    lightning = `<h2>Lightning round questions (${qs.length})</h2><ol>` + qs.map((q) => `<li><b>${esc(q.q)}</b><br>Correct: ${esc(q.correct)}<br><span class="al">Wrong: ${esc((q.wrong || []).join(' | '))}</span><br><span class="pe">${esc(q.why || '')}</span></li>`).join('') + '</ol>';
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Project Zebra question bank</title><style>
body{font:15px/1.4 system-ui,sans-serif;margin:0;padding:24px;background:#1a1220;color:#f6ead2}main{max-width:1100px;margin:0 auto}h1{margin:0 0 4px}h2{margin:32px 0 8px;border-bottom:1px solid #5a4458;padding-bottom:4px}h3{margin:20px 0 2px}.meta,.note{color:#cdb99a;margin:2px 0 8px}code{background:#33233a;padding:1px 5px;border-radius:4px}
table{border-collapse:collapse;width:100%;font-size:13px;margin-bottom:12px}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #3a2a3a;vertical-align:top}th{color:#cdb99a}td.sc{font-weight:700;text-align:right;width:3em}td.nm{font-weight:600}td.al,td.pe,.al,.pe{color:#cdb99a}
.t-student td.sc,.t-student td.tr{color:#b9a2ee}.t-intern td.sc,.t-intern td.tr{color:#7cc4ee}.t-senior td.sc,.t-senior td.tr{color:#86d98a}.t-fellow td.sc,.t-fellow td.tr{color:#f2e05a}.t-attending td.sc,.t-attending td.tr{color:#f58ad4}.t-bazo td.sc,.t-bazo td.tr{color:#ff5470}.t-trap td.sc,.t-trap td.tr{color:#ff8a3d}
a{color:#f2c46d}li{margin-bottom:10px}</style></head><body><main><h1>Project Zebra question bank</h1><p class="note">${prompts.length} prompts, ${total} scored answers. AI-written and not yet faculty-reviewed. This page shows every answer: do not share it with players. Data source: <code>data/clinical_prompts_db.json</code>.</p>${body}${lightning}</main></body></html>`;
}


const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-cache',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

function loadDb() {
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  if (!db || !Array.isArray(db.prompts) || db.prompts.length === 0) throw new Error(`No prompts in ${DB_PATH}`);
  return db;
}

/** Lightning-round multiple-choice bank. Optional: without it the add-on stays unavailable. */
const MC_EXTRA_PATH = process.env.ZEBRA_MC_EXTRA || path.join(ROOT, 'data', 'mc_extra.json');
function loadMc() {
  let base;
  try { base = JSON.parse(fs.readFileSync(MC_PATH, 'utf8')); } catch { console.warn(`[mc] no question bank at ${MC_PATH}; lightning round unavailable`); return null; }
  // Optional extra banks (data/mc_extra*.json): {questions:[...same schema, optional level 1-10], levels:{questionId: 1-10}}
  let merged = base;
  try {
    const dir = path.dirname(MC_EXTRA_PATH);
    const files = process.env.ZEBRA_MC_EXTRA ? [MC_EXTRA_PATH] : fs.readdirSync(dir).filter((f) => /^mc_extra.*\.json$/.test(f)).sort().map((f) => path.join(dir, f));
    for (const f of files) {
      try {
        const extra = JSON.parse(fs.readFileSync(f, 'utf8'));
        merged = { ...merged, questions: [...(merged.questions || []), ...(extra.questions || [])], levels: { ...(merged.levels || {}), ...(extra.levels || {}) } };
      } catch (e) { console.warn('[mc] skipped ' + f + ': ' + e.message); }
    }
  } catch { /* no extra banks */ }
  return merged;
}

function resolveFile(urlPath) {
  if (urlPath === '/' || urlPath === '/index.html') return path.join(PUBLIC, 'index.html');
  if (urlPath === '/host' || urlPath === '/host/') return path.join(PUBLIC, 'host.html');
  if (urlPath === '/play' || urlPath === '/play/') return path.join(PUBLIC, 'index.html');
  if (urlPath === '/solo' || urlPath === '/solo/') return path.join(PUBLIC, 'solo.html');
  if (urlPath === '/demo' || urlPath === '/demo/') return path.join(PUBLIC, 'demo.html');
  if (urlPath === '/vendor/qrcode.js') return QR_LIB;
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const full = path.resolve(PUBLIC, rel);
  if (!full.startsWith(PUBLIC + path.sep)) return null; // path traversal guard
  return full;
}

function createServer(db, mc, opts = {}) {
  const bankKey = opts.bankKey || null;
  const game = new Game(db, mc);
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); res.end(); return; }
    let urlPath;
    try { urlPath = new URL(req.url, 'http://x').pathname; } catch { res.writeHead(400, SECURITY_HEADERS); res.end(); return; }
    if (urlPath === '/healthz') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (urlPath === '/bank' || urlPath === '/bank.json') {
      const given = Buffer.from(String(new URL(req.url, 'http://x').searchParams.get('key') || ''));
      const want = Buffer.from(bankKey || '');
      if (!bankKey || given.length !== want.length || !crypto.timingSafeEqual(given, want)) { res.writeHead(404, SECURITY_HEADERS); res.end('Not found'); return; }
      const json = urlPath === '/bank.json';
      res.writeHead(200, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Content-Type': json ? MIME['.json'] : MIME['.html'] });
      res.end(req.method === 'HEAD' ? undefined : json ? JSON.stringify(db, null, 2) : bankPage(db, mc));
      return;
    }
    let file;
    try { file = resolveFile(urlPath); } catch { file = null; }
    // The front page is the landing screen; a join link (/?c=CODE, used by the QR code) still opens the phone join screen.
    if ((urlPath === '/' || urlPath === '/index.html') && !new URL(req.url, 'http://x').searchParams.get('c')) file = path.join(PUBLIC, 'landing.html');
    if (!file) { res.writeHead(404, SECURITY_HEADERS); res.end('Not found'); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
      const type = MIME[path.extname(file).toLowerCase()];
      if (!type) { res.writeHead(404, SECURITY_HEADERS); res.end('Not found'); return; }
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try { pathname = new URL(req.url, 'http://x').pathname; } catch { /* fallthrough */ }
    if (pathname !== '/ws' || wss.clients.size >= MAX_SOCKETS) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const conn = {
      room: null, player: null, isHost: false,
      send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
      close() { ws.close(); },
    };
    let bucket = 12; // token bucket: ~6 msgs/s sustained, burst 12
    const refill = setInterval(() => { bucket = Math.min(12, bucket + 3); }, 500);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      if (--bucket < 0) return; // drop floods silently
      let msg;
      try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      try { game.handle(conn, msg); } catch (e) { console.error('handler error', e); }
    });
    ws.on('close', () => { clearInterval(refill); game.closed(conn); });
    ws.on('error', () => { /* close handler cleans up */ });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 20000);
  heartbeat.unref();

  server.on('close', () => { clearInterval(heartbeat); game.stop(); });
  server.wsClients = wss.clients;
  game.socketCount = () => wss.clients.size;
  return { server, game, wss };
}

function lanAddresses() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  return out;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const db = loadDb();
  const mc = loadMc();
  const bankKey = loadBankKey();
  const { server, game } = createServer(db, mc, { bankKey });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Project Zebra running (${db.prompts.length} prompts from ${path.relative(ROOT, DB_PATH)}, ${game.db.mc.length} lightning questions)`);
    console.log(`  Host screen:  http://localhost:${port}/host`);
    console.log(`  Question bank: http://localhost:${port}/bank?key=${bankKey}`);
    for (const ip of lanAddresses()) console.log(`  On Wi-Fi:     http://${ip}:${port}/host`);
  });
}

module.exports = { createServer, loadDb, loadMc };
