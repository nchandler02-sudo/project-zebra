'use strict';
/**
 * Room and round logic. Transport-agnostic: a "connection" is any object with send(obj) and close().
 * The Server in index.js owns sockets; this file owns state, grading and timing.
 */

const crypto = require('crypto');
const { PromptMatcher } = require('./matcher');
const { Tournament, PICKS: RPS_PICKS, AWARDS } = require('./tournament');
const Activities = require('./activities');

// ZEBRA_ROUND_SECONDS overrides every difficulty's round length (used by tests).
const ENV_SECONDS = Number(process.env.ZEBRA_ROUND_SECONDS) || 0;

/**
 * Room difficulty. Casual is the default: every match scores at least 10, the phone tells you whether an answer is
 * on the list (never its points) and misses don't use up a slot. Standard and Zebra give fewer answers and less time.
 * Board-prep traps (negative base scores) are controlled separately by the room's `traps` option, see TRAPS.
 */
const DIFFICULTY = {
  casual: { label: 'Casual', seconds: 60, maxAnswers: 5, maxTries: 10, feedback: true, mcRight: 15, mcWrong: -5 },
  standard: { label: 'Standard', seconds: 45, maxAnswers: 3, maxTries: 3, feedback: false, mcRight: 20, mcWrong: -10 },
  zebra: { label: 'Zebra', seconds: 45, maxAnswers: 3, maxTries: 3, feedback: false, mcRight: 25, mcWrong: -15 },
};
// Lightning round add-on: when on, MC_SECONDS of multiple choice follow the normal round timer.
const MC_SECONDS = Number(process.env.ZEBRA_MC_SECONDS) || 30;
const MC_POOL = 40; // questions drawn per round; each player gets their own random order and sees questions they have not had yet
const MC_RELATED = 4; // at most this many pool slots go to questions tagged for the round's topic, the rest are random
const AWARDS_CHAMPION = AWARDS.champion; // leaderboard points for the tournament champion and finalist
const AWARDS_FINALIST = AWARDS.finalist;
const LOG_MAX = 80;
const DEFAULT_DIFFICULTY = 'casual';
const TRAP_COMMON_SHARE = 0.3;
// Board-prep traps: 'off' = a trap scores 0 (default), 'crowd' = costs points only when TRAP_COMMON_SHARE of the answering players named it, 'always' = always costs points.
const TRAPS = ['off', 'crowd', 'always'];
const DEFAULT_TRAPS = 'off';
const CASUAL_FLOOR = 10;
const MAX_NAME = 20;
const MAX_ANSWER = 80;
const MAX_PLAYERS_PER_ROOM = 600;
const MAX_ROOMS = 40;
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const TIER_LABELS = {
  student: 'Med Student',
  intern: 'Intern',
  senior: 'Senior Resident',
  fellow: 'Fellow',
  attending: 'Attending',
  bazo: 'Dr. Bazo',
  trap: 'Board Prep Trap',
  none: 'No match',
};

function tierFor(score) {
  if (score < 0) return 'trap';
  if (score >= 100) return 'bazo';
  if (score >= 80) return 'attending';
  if (score >= 56) return 'fellow';
  if (score >= 36) return 'senior';
  if (score >= 16) return 'intern';
  if (score >= 1) return 'student';
  return 'none';
}

const CONTROL_CHARS = new RegExp('[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]', 'g');

function cleanText(s, max) {
  return String(s == null ? '' : s)
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Database {
  constructor(db, mcJson) {
    this.prompts = db.prompts.map((p) => ({ ...p, matcher: new PromptMatcher(p) }));
    for (const p of this.prompts) {
      if (p.matcher.collisions.length) {
        console.warn(`[db] ${p.id}: ${p.matcher.collisions.length} alias collisions`, p.matcher.collisions.slice(0, 3));
      }
    }
    // Lightning-round multiple-choice bank: {id, q, correct, wrong:[3], why, tags:[prompt ids]}. Bad rows are skipped.
    this.mc = [];
    const seen = new Set();
    for (const raw of (mcJson && Array.isArray(mcJson.questions) ? mcJson.questions : [])) {
      const opts = raw && Array.isArray(raw.wrong) ? [raw.correct, ...raw.wrong].map((s) => String(s == null ? '' : s).trim()) : [];
      const distinct = new Set(opts.map((s) => s.toLowerCase()));
      if (!raw || !raw.id || seen.has(raw.id) || !raw.q || opts.length !== 4 || distinct.size !== 4 || opts.some((s) => !s)) {
        console.warn(`[mc] skipped invalid question ${raw && raw.id}`);
        continue;
      }
      seen.add(raw.id);
      const lv = Number(raw.level != null ? raw.level : (mcJson.levels || {})[raw.id]);
      this.mc.push({ id: String(raw.id), q: String(raw.q), correct: opts[0], wrong: opts.slice(1), why: String(raw.why || ''), tags: Array.isArray(raw.tags) ? raw.tags : [], level: lv >= 1 && lv <= 10 ? Math.round(lv) : 0 });
    }
  }
  byDifficulty(impossible) {
    return this.prompts.filter((p) => (p.difficulty === 'impossible') === impossible);
  }
}

class Room {
  constructor(code, hostKey, db) {
    this.code = code;
    this.hostKey = hostKey;
    this.db = db;
    this.host = null; // connection
    this.players = new Map(); // pid -> player
    this.nextPid = 1;
    this.phase = 'lobby';
    this.difficulty = DEFAULT_DIFFICULTY;
    this.traps = DEFAULT_TRAPS;
    this.roundNo = 0;
    this.prompt = null;
    this.impossible = false;
    this.endsAt = 0;
    this.depth = 0;
    this.found = new Set(); // answer indexes found this round
    this.reveal = null;
    this.used = { standard: new Set(), impossible: new Set() };
    this.lastBroadcastSec = -1;
    this.touched = Date.now();
    this.createdAt = Date.now();
    this.lightning = false;      // add-on: multiple-choice questions in the last MC_SECONDS of each round
    this.mcPool = [];            // this round's questions
    this.mcAnnounced = false;
    this.usedMc = new Set();
    this.tourney = null;         // rock-paper-scissors tournament (phase 'break')
    this.prevPhase = 'lobby';    // where the room returns to when the tournament or an activity ends
    this.activity = null;        // plug-in game mode while phase === 'activity' (see server/activities/README.md)
    this.log = [];               // ring buffer of recent events, shown in the host debug panel
  }

  // ---------- helpers ----------
  cfg() { return DIFFICULTY[this.difficulty]; }
  roundSeconds() { return ENV_SECONDS || this.cfg().seconds; }
  maxAnswers() { return this.cfg().maxAnswers; }
  slotsUsed(p) { return p.answers.filter((a) => a.counts).length; }

  logEvent(msg) {
    this.log.push({ at: Date.now(), msg: String(msg).slice(0, 160) });
    if (this.log.length > LOG_MAX) this.log.shift();
  }

  setOptions(opts) {
    if (this.phase === 'round' || this.phase === 'break' || this.phase === 'activity') return;
    if (opts && DIFFICULTY[opts.difficulty]) { this.difficulty = opts.difficulty; this.logEvent(`difficulty -> ${opts.difficulty}`); }
    if (opts && TRAPS.includes(opts.traps)) { this.traps = opts.traps; this.logEvent(`traps -> ${opts.traps}`); }
    if (opts && typeof opts.lightning === 'boolean') {
      if (opts.lightning && !this.db.mc.length) {
        this.host && this.host.send({ t: 'error', message: 'No lightning questions are loaded on the server.' });
      } else {
        this.lightning = opts.lightning;
        this.logEvent(`lightning round ${this.lightning ? 'ON' : 'off'}`);
      }
    }
    this.touch();
    this.broadcast();
  }

  /** Throw away scores and rounds and go back to the lobby. kickAll also removes every player. */
  restart(kickAll) {
    this.touch();
    if (kickAll) {
      for (const p of this.players.values()) {
        if (p.conn) { p.conn.send({ t: 'error', message: 'The host reset the game. Scan the code to join again.', fatal: true }); try { p.conn.close(); } catch { /* ignore */ } }
      }
      this.players.clear();
    } else {
      for (const p of this.players.values()) { p.score = 0; p.answers = []; p.roundPoints = 0; p.mc = null; p.seenMc = new Set(); }
    }
    this.tourney = null;
    this.activity = null;
    this.phase = 'lobby';
    this.roundNo = 0;
    this.prompt = null;
    this.impossible = false;
    this.endsAt = 0;
    this.depth = 0;
    this.found = new Set();
    this.reveal = null;
    this.used = { standard: new Set(), impossible: new Set() };
    this.usedMc = new Set();
    this.mcPool = [];
    this.mcAnnounced = false;
    this.logEvent(kickAll ? 'RESTART: scores reset, all players removed' : 'RESTART: scores reset, players kept');
    this.broadcast();
  }

  // ---------- activities (plug-in game modes) ----------
  addScore(pid, points) {
    const p = this.players.get(pid);
    const n = Math.trunc(Number(points));
    if (p && Number.isFinite(n)) p.score += n;
  }

  sendTo(pid, obj) {
    const p = this.players.get(pid);
    if (p && p.conn) p.conn.send(obj);
  }

  startActivity(type, opts) {
    if (this.phase === 'round' || this.phase === 'break' || this.phase === 'activity') return;
    const connected = [...this.players.values()].filter((p) => p.connected).length;
    let act = null;
    try { act = Activities.create(String(type || ''), this, opts && typeof opts === 'object' ? opts : {}); } catch (e) { console.error('activity start failed', e); }
    if (!act) { this.host && this.host.send({ t: 'error', message: 'That activity could not start.' }); return; }
    const need = (act.constructor.meta && act.constructor.meta.minPlayers) || 1;
    if (connected < need) { this.host && this.host.send({ t: 'error', message: `This activity needs at least ${need} connected player${need === 1 ? '' : 's'}.` }); return; }
    this.touch();
    this.prevPhase = this.phase;
    this.activity = act;
    this.phase = 'activity';
    this.logEvent('activity start: ' + type + ', ' + connected + ' players');
    this.broadcast();
  }

  endActivity() {
    if (this.phase !== 'activity') return;
    const type = this.activity && this.activity.constructor.meta ? this.activity.constructor.meta.type : '?';
    this.activity = null;
    this.phase = this.prevPhase === 'reveal' && this.reveal ? 'reveal' : 'lobby';
    this.logEvent('activity closed: ' + type);
    this.touch();
    this.broadcast();
    if (this.phase === 'reveal') for (const p of this.players.values()) this.sendReveal(p);
  }

  activityPlayer(p, d) {
    if (this.phase !== 'activity' || !this.activity || typeof this.activity.handle !== 'function') return;
    let reply;
    try { reply = this.activity.handle(p, d); } catch (e) { console.error('activity handle error', e); return; }
    if (reply && typeof reply === 'object' && p.conn) p.conn.send({ t: 'act_ack', d: reply });
    this.touch();
    this.broadcast();
  }

  activityHost(cmd, d) {
    if (this.phase !== 'activity' || !this.activity || typeof this.activity.hostCommand !== 'function') return;
    try { this.activity.hostCommand(String(cmd || '').slice(0, 40), d); } catch (e) { console.error('activity host error', e); return; }
    this.touch();
    this.broadcast();
  }

  // ---------- rock-paper-scissors tournament (break game) ----------
  startTournament() {
    if (this.phase === 'round' || this.phase === 'break' || this.phase === 'activity') return;
    const entrants = [...this.players.values()].filter((p) => p.connected).map((p) => ({ id: p.id, name: p.name }));
    if (entrants.length < 2) { this.host && this.host.send({ t: 'error', message: 'A tournament needs at least 2 connected players.' }); return; }
    this.touch();
    this.prevPhase = this.phase;
    this.tourney = new Tournament(
      entrants,
      (pid) => { const p = this.players.get(pid); return !!(p && p.connected); },
      (champ, finalist) => {
        const c = this.players.get(champ), f = finalist != null ? this.players.get(finalist) : null;
        if (c) c.score += AWARDS_CHAMPION;
        if (f) f.score += AWARDS_FINALIST;
        this.logEvent('tournament over: champion ' + (c ? c.name : champ) + (f ? ', finalist ' + f.name : ''));
      }
    );
    this.phase = 'break';
    this.logEvent('tournament start: ' + entrants.length + ' players, ' + this.tourney.maxLives + ' lives each');
    this.broadcast();
  }

  endTournament() {
    if (this.phase !== 'break') return;
    this.tourney = null;
    this.phase = this.prevPhase === 'reveal' && this.reveal ? 'reveal' : 'lobby';
    this.logEvent('tournament closed');
    this.touch();
    this.broadcast();
    if (this.phase === 'reveal') for (const p of this.players.values()) this.sendReveal(p);
  }

  rpsPick(p, pick) {
    if (this.phase !== 'break' || !this.tourney) return;
    const r = this.tourney.pick(p.id, pick);
    if (r === 'resolved') this.broadcast();
    else if (r === 'locked') { // only the host and the player need to hear about a lock-in
      const { rank } = this.ranks();
      if (this.host) this.host.send(this.hostState());
      if (p.conn) p.conn.send(this.playerState(p, rank));
    }
  }

  // ---------- lightning round ----------
  mcWindowMs() { return MC_SECONDS * 1000; }
  /** Length of the stage on screen (normal timer, then the lightning stage) and time left in it. */
  stageSeconds() { return this.mcActive() ? MC_SECONDS : this.roundSeconds(); }
  stageEndsInMs() {
    if (this.phase !== 'round') return 0;
    const left = this.endsInMs();
    return this.lightning && this.mcPool.length && left > this.mcWindowMs() ? left - this.mcWindowMs() : left;
  }
  /** Host pressed End: skip to the lightning questions if they are still ahead, otherwise end the round. */
  hostEnd() {
    if (this.phase !== 'round') return;
    if (this.lightning && this.mcPool.length && !this.mcActive()) {
      this.endsAt = Date.now() + this.mcWindowMs();
      this.logEvent('host skipped to lightning questions');
      this.mcAnnounced = true;
      this.broadcast();
    } else this.endRound();
  }
  mcActive() { return this.lightning && this.phase === 'round' && this.mcPool.length > 0 && this.endsInMs() <= this.mcWindowMs(); }

  /** Pick this round's questions: a few tagged for the topic, the rest random from the whole bank, preferring unused. */
  pickMcPool() {
    const all = this.db.mc;
    let fresh = all.filter((q) => !this.usedMc.has(q.id));
    if (fresh.length < MC_POOL) { this.usedMc.clear(); fresh = all.slice(); }
    const related = shuffle(fresh.filter((q) => q.tags.includes(this.prompt.id))).slice(0, MC_RELATED);
    const taken = new Set(related.map((q) => q.id));
    const rest = shuffle(fresh.filter((q) => !taken.has(q.id)));
    const pool = shuffle(related.concat(rest).slice(0, MC_POOL));
    pool.forEach((q) => this.usedMc.add(q.id));
    return pool;
  }

  mcState(p) {
    if (!p.mc) {
      // each player's own random order, questions they have not been shown in this game first
      const seen = p.seenMc || (p.seenMc = new Set());
      const idx = shuffle(this.mcPool.map((_, i) => i));
      const order = idx.filter((i) => !seen.has(this.mcPool[i].id)).concat(idx.filter((i) => seen.has(this.mcPool[i].id)));
      p.mc = { order, pos: 0, cur: null, right: 0, wrong: 0, points: 0, items: [] };
    }
    return p.mc;
  }

  /** The question this player is looking at right now (options shuffled per player), or null. */
  mcCurrent(p) {
    if (!this.mcActive()) return null;
    const st = this.mcState(p);
    if (st.cur) return st.cur;
    if (st.pos >= st.order.length) return null;
    const q = this.mcPool[st.order[st.pos]];
    const opts = shuffle([q.correct, ...q.wrong]);
    (p.seenMc || (p.seenMc = new Set())).add(q.id);
    st.cur = { qid: q.id, q: q.q, opts, correctIdx: opts.indexOf(q.correct), why: q.why };
    return st.cur;
  }

  mcAnswer(p, qid, choice) {
    if (!this.mcActive()) return { ok: false, error: 'The lightning questions are not open.' };
    const cur = this.mcCurrent(p);
    if (!cur || cur.qid !== qid) return { ok: false, error: 'That question is no longer open.' };
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) return { ok: false, error: 'Pick one of the four choices.' };
    const cfg = this.cfg();
    const st = this.mcState(p);
    const correct = choice === cur.correctIdx;
    const delta = correct ? cfg.mcRight : cfg.mcWrong;
    if (correct) st.right += 1; else st.wrong += 1;
    st.points += delta;
    st.items.push({ q: cur.q, chosen: cur.opts[choice], correct: cur.opts[cur.correctIdx], ok: correct, why: cur.why, delta });
    st.cur = null;
    st.pos += 1;
    this.touch();
    this.logEvent(`lightning: ${p.name} ${correct ? 'right' : 'wrong'} (${cur.qid})`);
    return { ok: true, correct, delta, correctIdx: cur.correctIdx, why: cur.why, right: st.right, wrong: st.wrong };
  }

  mcSummary() {
    const per = new Map();
    for (const q of this.mcPool) per.set(q.q, { q: q.q, correct: q.correct, why: q.why, right: 0, wrong: 0 });
    const top = [];
    let right = 0, wrong = 0;
    for (const p of this.players.values()) {
      if (!p.mc) continue;
      right += p.mc.right; wrong += p.mc.wrong;
      if (p.mc.items.length) top.push({ name: p.name, points: p.mc.points, right: p.mc.right, wrong: p.mc.wrong });
      for (const it of p.mc.items) { const s = per.get(it.q); if (s) { if (it.ok) s.right += 1; else s.wrong += 1; } }
    }
    top.sort((a, b) => b.points - a.points || b.right - a.right);
    const questions = [...per.values()].filter((s) => s.right + s.wrong > 0).sort((a, b) => b.wrong - a.wrong || (b.right + b.wrong) - (a.right + a.wrong));
    return { right, wrong, top: top.slice(0, 3), questions: questions.slice(0, 3) };
  }

  /** Points for an answer's base score after the room's difficulty rules. */
  pointsFor(base, named, participants) {
    if (base < 0) {
      if (this.traps === 'off') return 0;
      if (this.traps === 'crowd') return participants > 0 && named / participants >= TRAP_COMMON_SHARE ? base : 0;
      return base;
    }
    if (this.difficulty === 'casual' && base > 0 && base < CASUAL_FLOOR) return CASUAL_FLOOR;
    return base;
  }

  touch() { this.touched = Date.now(); }
  secondsLeft() { return Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000)); }
  endsInMs() { return this.phase === 'round' ? Math.max(0, this.endsAt - Date.now()) : 0; }

  ranks() {
    const sorted = [...this.players.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const rank = new Map();
    sorted.forEach((p, i) => {
      rank.set(p.id, i > 0 && sorted[i - 1].score === p.score ? rank.get(sorted[i - 1].id) : i + 1);
    });
    return { sorted, rank };
  }

  uniqueName(name) {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; n < 1000; n++) {
      const suffix = ` ${n}`;
      const candidate = name.slice(0, MAX_NAME - suffix.length) + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  // ---------- players ----------
  join(conn, rawName, token) {
    this.touch();
    if (token) {
      for (const p of this.players.values()) {
        if (p.token === token) {
          if (p.conn && p.conn !== conn) { try { p.conn.close(); } catch { /* already closed */ } }
          p.conn = conn;
          p.connected = true;
          conn.player = p;
          conn.room = this;
          this.sendWelcome(p);
          this.broadcast();
          if (this.phase === 'reveal') this.sendReveal(p);
          return p;
        }
      }
    }
    const name = cleanText(rawName, MAX_NAME);
    if (!name) { conn.send({ t: 'error', message: 'Please enter a nickname.' }); return null; }
    if (this.players.size >= MAX_PLAYERS_PER_ROOM) {
      conn.send({ t: 'error', message: 'This room is full.', fatal: true });
      return null;
    }
    const p = {
      id: this.nextPid++,
      token: crypto.randomBytes(12).toString('hex'),
      name: this.uniqueName(name),
      conn,
      connected: true,
      score: 0,
      answers: [],
      roundPoints: 0,
      mc: null,
    };
    this.players.set(p.id, p);
    conn.player = p;
    conn.room = this;
    this.logEvent(`join: ${p.name}`);
    this.sendWelcome(p);
    this.broadcast();
    return p;
  }

  sendWelcome(p) {
    p.conn.send({ t: 'welcome', pid: p.id, token: p.token, name: p.name, code: this.code });
  }

  disconnectPlayer(p, conn) {
    if (p.conn === conn) { p.connected = false; p.conn = null; this.logEvent(`disconnect: ${p.name}`); this.broadcast(); }
  }

  kick(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    this.logEvent(`kick: ${p.name}`);
    if (p.conn) { p.conn.send({ t: 'error', message: 'You were removed from the room.', fatal: true }); try { p.conn.close(); } catch { /* ignore */ } }
    this.players.delete(pid);
    this.broadcast();
  }

  // ---------- rounds ----------
  pickPrompt(impossible) {
    let pool = this.db.byDifficulty(impossible);
    if (!pool.length) { pool = this.db.byDifficulty(!impossible); impossible = !impossible; }
    // Prompts may carry level:"easy". Casual prefers them, Zebra avoids them, Standard mixes everything.
    const levelOk = (p) => (this.difficulty === 'casual' ? p.level === 'easy' : this.difficulty === 'zebra' ? p.level !== 'easy' : true);
    const preferred = pool.filter(levelOk);
    if (preferred.length) pool = preferred;
    const usedSet = this.used[impossible ? 'impossible' : 'standard'];
    let fresh = pool.filter((p) => !usedSet.has(p.id));
    if (!fresh.length) { usedSet.clear(); fresh = pool; }
    const prompt = fresh[crypto.randomInt(fresh.length)];
    usedSet.add(prompt.id);
    return prompt;
  }

  startRound(wantImpossible) {
    if (this.phase === 'round' || this.phase === 'break' || this.phase === 'activity') return;
    if (this.players.size === 0) { this.host && this.host.send({ t: 'error', message: 'Wait for at least one player to join.' }); return; }
    this.touch();
    this.prompt = this.pickPrompt(!!wantImpossible);
    this.impossible = this.prompt.difficulty === 'impossible';
    this.roundNo += 1;
    this.depth = 0;
    this.found = new Set();
    this.reveal = null;
    this.mcPool = this.lightning ? this.pickMcPool() : [];
    this.mcAnnounced = false;
    for (const p of this.players.values()) { p.answers = []; p.roundPoints = 0; p.mc = null; }
    this.phase = 'round';
    this.endsAt = Date.now() + (this.roundSeconds() + (this.mcPool.length ? MC_SECONDS : 0)) * 1000;
    this.lastBroadcastSec = this.roundSeconds();
    this.logEvent(`round ${this.roundNo} start: ${this.prompt.id} (${this.difficulty}${this.lightning ? ', lightning' : ''}${this.impossible ? ', impossible' : ''})`);
    this.broadcast();
  }

  submit(p, rawText) {
    if (this.phase !== 'round') return { ok: false, error: 'The round is not open.' };
    if (this.mcActive()) return { ok: false, error: 'Lightning questions are live. Answer those!' };
    const cfg = this.cfg();
    const text = cleanText(rawText, MAX_ANSWER);
    if (!text) return { ok: false, error: 'Type an answer first.' };
    if (this.slotsUsed(p) >= cfg.maxAnswers) return { ok: false, text, error: 'No answers left this round.' };
    if (p.answers.length >= cfg.maxTries) return { ok: false, text, error: 'No more tries this round.' };
    const m = this.prompt.matcher.match(text);
    // Only Casual tells the player "be more specific"; elsewhere an ambiguous answer is just a miss, so nothing leaks.
    if (m.method === 'ambiguous' && cfg.feedback) return { ok: false, text, error: 'Be more specific.' };
    const matched = m.matched;
    const key = matched ? `i${m.index}` : `n${m.normalized}`;
    const sameText = p.answers.some((a) => a.norm === m.normalized);
    if (sameText) return { ok: false, text, error: 'You already submitted that.' };
    if (matched && p.answers.some((a) => a.key === key)) {
      // Same answer typed another way. Casual says so (it is already giving feedback); otherwise stay silent.
      return cfg.feedback
        ? { ok: false, text, error: 'You already submitted that.' }
        : { ok: true, text, duplicate: true, used: this.slotsUsed(p) };
    }
    const entry = { key, norm: m.normalized, text, matched, answer: null, idx: matched ? m.index : -1, base: 0, points: 0, tier: 'none', counts: cfg.feedback ? matched : true };
    if (matched) {
      const ans = this.prompt.answers[m.index];
      entry.answer = ans.name;
      entry.base = ans.score;
      entry.tier = tierFor(ans.score);
      this.found.add(m.index);
      if (ans.score > this.depth) this.depth = ans.score;
    }
    p.answers.push(entry);
    this.touch();
    this.logEvent(`answer: ${p.name} "${text.slice(0, 40)}" ${matched ? '-> ' + entry.answer : '(no match)'}`);
    return { ok: true, text, used: this.slotsUsed(p), matched: cfg.feedback ? matched : undefined };
  }

  /** Missed answers worth teaching: the most attainable ones first, plus one zebra. */
  teachingMisses() {
    const missed = [];
    this.prompt.answers.forEach((ans, idx) => { if (!this.found.has(idx) && ans.score > 0) missed.push(ans); });
    const byAttainable = (a, b) => (b.pearl ? 1 : 0) - (a.pearl ? 1 : 0) || a.score - b.score;
    const teach = missed.filter((a) => a.score >= 5 && a.score <= 59).sort(byAttainable);
    const zebras = missed.filter((a) => a.score >= 80).sort(byAttainable);
    const chosen = [];
    const add = (a, kind) => { if (a && !chosen.some((c) => c.ans === a)) chosen.push({ ans: a, kind }); };
    add(teach[0], 'teach'); add(teach[1], 'teach'); add(zebras[0], 'zebra'); add(teach[2], 'teach');
    if (chosen.length < 4) {
      for (const a of [...missed].sort(byAttainable)) { if (chosen.length >= 4) break; add(a, a.score >= 80 ? 'zebra' : 'teach'); }
    }
    return chosen.map(({ ans, kind }) => this.tierInfo(ans.score, { answer: ans.name, pearl: ans.pearl || '', kind }));
  }

  endRound() {
    if (this.phase !== 'round') return;
    const topMissed = this.teachingMisses();

    // How many of the players who answered named each answer (for the Standard trap rule).
    const named = new Map();
    let participants = 0;
    for (const p of this.players.values()) {
      if (p.answers.length) participants++;
      for (const a of p.answers) if (a.matched) named.set(a.idx, (named.get(a.idx) || 0) + 1);
    }

    let bestFind = null;
    const playersOut = [];
    for (const p of this.players.values()) {
      for (const a of p.answers) a.points = a.matched ? this.pointsFor(a.base, named.get(a.idx) || 0, participants) : 0;
      const mcPoints = this.lightning && p.mc ? p.mc.points : 0;
      p.roundPoints = p.answers.reduce((sum, a) => sum + a.points, 0) + mcPoints;
      p.score += p.roundPoints;
      const answers = p.answers.map((a) => {
        const info = this.tierInfo(a.points, { text: a.text, matched: a.matched, answer: a.answer }, a.tier);
        if (a.tier === 'trap' && a.points === 0) info.tierLabel = 'Board Prep Trap (no penalty)';
        return info;
      });
      playersOut.push({
        id: p.id, name: p.name, roundPoints: p.roundPoints, answers,
        ...(this.lightning && p.mc ? { mc: { right: p.mc.right, wrong: p.mc.wrong, points: p.mc.points } } : {}),
      });
      for (const a of p.answers) {
        if (a.matched && a.points > 0 && (!bestFind || a.points > bestFind.points)) {
          bestFind = { name: p.name, answer: a.answer, points: a.points, tier: a.tier };
        }
      }
    }
    playersOut.sort((a, b) => b.roundPoints - a.roundPoints);
    // Every answer on the list with what it was worth this round and how many players named it.
    const answerList = this.prompt.answers.map((ans, idx) => {
      const tier = tierFor(ans.score);
      const n = named.get(idx) || 0;
      return { name: ans.name, points: this.pointsFor(ans.score, n, participants), tier, tierLabel: TIER_LABELS[tier], named: n };
    }).sort((a, b) => (b.tier === 'trap' ? -1 : 0) - (a.tier === 'trap' ? -1 : 0) || b.points - a.points || a.name.localeCompare(b.name));
    this.reveal = {
      players: playersOut, topMissed, answerList, found: this.found.size, total: this.prompt.answers.length, bestFind,
      lightning: this.lightning ? this.mcSummary() : null,
    };
    this.phase = 'reveal';
    this.logEvent(`round ${this.roundNo} end: room found ${this.found.size}/${this.prompt.answers.length}`);
    this.touch();
    this.broadcast();
    for (const p of this.players.values()) this.sendReveal(p);
  }

  tierInfo(points, extra, tierOverride) {
    const tier = tierOverride || tierFor(points);
    return { ...extra, points, tier, tierLabel: TIER_LABELS[tier] };
  }

  // ---------- messages ----------
  hostState() {
    const { sorted } = this.ranks();
    const inRound = (this.phase === 'round' || this.phase === 'reveal') && this.prompt;
    return {
      t: 'host_state',
      code: this.code,
      phase: this.phase,
      roundNo: this.roundNo,
      roundSeconds: this.stageSeconds(),
      endsInMs: this.stageEndsInMs(),
      maxAnswers: this.maxAnswers(),
      difficulty: this.difficulty,
      difficultyLabel: this.cfg().label,
      traps: this.traps,
      tierLabels: TIER_LABELS,
      lightning: this.lightningInfo(),
      tourney: this.tourney ? this.tourney.hostView() : null,
      activity: this.activityHostView(),
      activities: this.phase === 'activity' ? [] : Activities.list(),
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, connected: p.connected, score: p.score, answered: this.slotsUsed(p),
        mcDone: p.mc ? p.mc.right + p.mc.wrong : 0,
      })),
      leaderboard: sorted.map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected })),
      round: inRound
        ? { category: this.prompt.category, prompt: this.prompt.prompt, impossible: this.impossible, depth: this.depth }
        : null,
      reveal: this.phase === 'reveal' ? this.reveal : null,
    };
  }

  activityHostView() {
    if (this.phase !== 'activity' || !this.activity) return null;
    try { return { type: this.activity.constructor.meta.type, finished: !!this.activity.finished, ...this.activity.hostView() }; } catch (e) { console.error('activity hostView error', e); return null; }
  }

  activityPlayerView(pid) {
    if (this.phase !== 'activity' || !this.activity) return null;
    try { return { type: this.activity.constructor.meta.type, finished: !!this.activity.finished, ...this.activity.playerView(pid) }; } catch (e) { console.error('activity playerView error', e); return null; }
  }

  lightningInfo() {
    const cfg = this.cfg();
    let answered = 0;
    for (const p of this.players.values()) if (p.mc) answered += p.mc.right + p.mc.wrong;
    return {
      on: this.lightning,
      available: this.db.mc.length > 0,
      active: this.mcActive(),
      windowSeconds: MC_SECONDS,
      pointsRight: cfg.mcRight,
      pointsWrong: cfg.mcWrong,
      answered,
    };
  }

  playerState(p, rank) {
    const inRound = (this.phase === 'round' || this.phase === 'reveal') && this.prompt;
    let lightning = null;
    if (this.lightning) {
      const active = this.mcActive();
      const cur = active ? this.mcCurrent(p) : null;
      const st = p.mc;
      lightning = {
        on: true,
        active,
        windowMs: this.mcWindowMs(),
        pointsRight: this.cfg().mcRight,
        pointsWrong: this.cfg().mcWrong,
        right: st ? st.right : 0,
        wrong: st ? st.wrong : 0,
        done: active && !cur,
        q: cur ? { id: cur.qid, q: cur.q, options: cur.opts } : null,
      };
    }
    return {
      t: 'p_state',
      phase: this.phase,
      roundNo: this.roundNo,
      roundSeconds: this.stageSeconds(),
      endsInMs: this.stageEndsInMs(),
      round: inRound ? { category: this.prompt.category, prompt: this.prompt.prompt, impossible: this.impossible } : null,
      answersUsed: this.slotsUsed(p),
      maxAnswers: this.maxAnswers(),
      difficulty: this.difficulty,
      feedback: this.cfg().feedback,
      lightning,
      tourney: this.tourney ? this.tourney.playerView(p.id) : null,
      activity: this.activityPlayerView(p.id),
      score: p.score,
      rank: rank.get(p.id) || 0,
      playerCount: this.players.size,
    };
  }

  sendReveal(p) {
    if (!p.conn || !this.reveal) return;
    const { rank } = this.ranks();
    const mine = this.reveal.players.find((x) => x.id === p.id);
    p.conn.send({
      t: 'reveal',
      impossible: this.impossible,
      results: mine ? mine.answers : [],
      roundPoints: mine ? mine.roundPoints : 0,
      score: p.score,
      rank: rank.get(p.id) || 0,
      topMissed: this.reveal.topMissed.slice(0, 3),
      answerList: this.reveal.answerList,
      playerCount: this.players.size,
      mc: this.lightning && p.mc ? { right: p.mc.right, wrong: p.mc.wrong, points: p.mc.points, items: p.mc.items.slice(0, MC_POOL) } : null,
    });
  }

  /** Host-only diagnostics. Never includes host keys or player tokens. */
  debugInfo() {
    return {
      code: this.code,
      phase: this.phase,
      roundNo: this.roundNo,
      difficulty: this.difficulty,
      traps: this.traps,
      lightning: this.lightning,
      mcActive: this.mcActive(),
      mcPool: this.mcPool.map((q) => q.id),
      promptId: this.prompt ? this.prompt.id : null,
      promptAnswers: this.prompt ? this.prompt.answers.length : 0,
      found: this.found.size,
      depth: this.depth,
      endsInMs: this.endsInMs(),
      hostConnected: !!this.host,
      tourney: this.tourney ? { stage: this.tourney.stage, round: this.tourney.roundNo, alive: this.tourney.alive.length, lives: this.tourney.maxLives } : null,
      ageSec: Math.round((Date.now() - this.createdAt) / 1000),
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, connected: p.connected, score: p.score,
        answers: p.answers.length, matched: p.answers.filter((a) => a.matched).length,
        mcRight: p.mc ? p.mc.right : 0, mcWrong: p.mc ? p.mc.wrong : 0,
      })),
      log: this.log.slice(-60),
    };
  }

  /**
   * Send the current state to the host and every phone. Bursts are batched: the first call goes out at once, further
   * calls inside a short window are merged into one trailing send. The window grows with the room (80 ms plus 1 ms per
   * player, max 600 ms) so 500 phones answering at once cost a few sends per second, not 500 sends per answer.
   */
  broadcast() {
    const now = Date.now();
    const gap = Math.min(600, 80 + this.players.size);
    if (!this.lastBroadcastAt || now - this.lastBroadcastAt >= gap) { this.lastBroadcastAt = now; this.sendStates(); return; }
    if (this.bcTimer) return;
    this.bcTimer = setTimeout(() => { this.bcTimer = null; this.lastBroadcastAt = Date.now(); this.sendStates(); }, gap - (now - this.lastBroadcastAt));
    if (this.bcTimer.unref) this.bcTimer.unref();
  }

  sendStates() {
    if (this.host) this.host.send(this.hostState());
    const { rank } = this.ranks();
    for (const p of this.players.values()) if (p.conn) p.conn.send(this.playerState(p, rank));
  }

  tick(now) {
    if (this.phase === 'break' && this.tourney) { if (this.tourney.tick(now)) this.broadcast(); return; }
    if (this.phase === 'activity' && this.activity) {
      let changed = false;
      try { changed = typeof this.activity.tick === 'function' && !!this.activity.tick(now); } catch (e) { console.error('activity tick error', e); }
      if (changed) this.broadcast();
      return;
    }
    if (this.phase !== 'round') return;
    if (now >= this.endsAt) { this.endRound(); return; }
    if (this.lightning && !this.mcAnnounced && this.mcActive()) {
      this.mcAnnounced = true; // switch phones to the lightning questions at the exact moment, not on the next 1 s tick
      this.logEvent('lightning questions open');
      this.broadcast();
      return;
    }
    const sec = this.secondsLeft();
    if (sec !== this.lastBroadcastSec) { this.lastBroadcastSec = sec; this.broadcast(); }
  }
}

class Game {
  constructor(dbJson, mcJson) {
    this.db = new Database(dbJson, mcJson);
    this.startedAt = Date.now();
    this.socketCount = () => 0; // index.js replaces this with the live WebSocket count
    this.rooms = new Map();
    this.timer = setInterval(() => this.tick(), 250);
    this.timer.unref();
  }

  stop() { clearInterval(this.timer); }

  newCode() {
    for (let i = 0; i < 200; i++) {
      let c = '';
      for (let k = 0; k < 4; k++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    return null;
  }

  createRoom(hostConn) {
    this.sweep();
    if (this.rooms.size >= MAX_ROOMS) { hostConn.send({ t: 'error', message: 'The server is busy. Try again later.', fatal: true }); return null; }
    const code = this.newCode();
    if (!code) return null;
    const room = new Room(code, crypto.randomBytes(16).toString('hex'), this.db);
    room.host = hostConn;
    hostConn.room = room;
    hostConn.isHost = true;
    this.rooms.set(code, room);
    hostConn.send({ t: 'hosted', code, hostKey: room.hostKey });
    room.broadcast();
    return room;
  }

  resumeRoom(hostConn, code, hostKey) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    const a = Buffer.from(String(hostKey || ''));
    const b = Buffer.from(room ? room.hostKey : '');
    if (!room || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      hostConn.send({ t: 'error', message: 'That room has ended. Start a new one.', fatal: true });
      return null;
    }
    if (room.host && room.host !== hostConn) { try { room.host.close(); } catch { /* ignore */ } }
    room.host = hostConn;
    hostConn.room = room;
    hostConn.isHost = true;
    room.touch();
    hostConn.send({ t: 'hosted', code: room.code, hostKey: room.hostKey });
    room.broadcast();
    if (room.phase === 'reveal') hostConn.send(room.hostState());
    return room;
  }

  joinRoom(conn, code, name, token) {
    const room = this.rooms.get(String(code || '').toUpperCase().slice(0, 4));
    if (!room) { conn.send({ t: 'error', message: 'No such room. Check the code on the big screen.', fatal: true }); return null; }
    return room.join(conn, name, token);
  }

  /** Dispatch one parsed client message. */
  handle(conn, msg) {
    switch (msg.t) {
      case 'host_create': if (!conn.room) this.createRoom(conn); break;
      case 'host_resume': if (!conn.room) this.resumeRoom(conn, msg.code, msg.hostKey); break;
      case 'join': if (!conn.room) this.joinRoom(conn, msg.code, msg.name, typeof msg.token === 'string' ? msg.token : ''); break;
      case 'start_round': if (conn.isHost) conn.room.startRound(!!msg.impossible); break;
      case 'end_round': if (conn.isHost) conn.room.hostEnd(); break;
      case 'set_options': if (conn.isHost) conn.room.setOptions(msg); break;
      case 'start_tournament': if (conn.isHost) conn.room.startTournament(); break;
      case 'end_tournament': if (conn.isHost) conn.room.endTournament(); break;
      case 'start_activity': if (conn.isHost) conn.room.startActivity(msg.type, msg.opts); break;
      case 'end_activity': if (conn.isHost) conn.room.endActivity(); break;
      case 'act_host': if (conn.isHost) conn.room.activityHost(msg.cmd, msg.d); break;
      case 'act': if (conn.player && conn.room) conn.room.activityPlayer(conn.player, msg.d); break;
      case 'rps': if (conn.player && conn.room && RPS_PICKS.includes(msg.pick)) conn.room.rpsPick(conn.player, msg.pick); break;
      case 'restart': if (conn.isHost) conn.room.restart(!!msg.kickAll); break;
      case 'debug':
        if (conn.isHost && conn.room) {
          const mem = process.memoryUsage();
          conn.send({
            t: 'debug_info',
            serverTime: Date.now(),
            uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
            node: process.version,
            rssMB: Math.round(mem.rss / 1048576),
            rooms: this.rooms.size,
            sockets: this.socketCount(),
            prompts: this.db.prompts.length,
            easyPrompts: this.db.prompts.filter((p) => p.level === 'easy').length,
            mcQuestions: this.db.mc.length,
            room: conn.room.debugInfo(),
          });
        }
        break;
      case 'kick': if (conn.isHost && Number.isInteger(msg.pid)) conn.room.kick(msg.pid); break;
      case 'mc_answer':
        if (conn.player && conn.room) {
          const r = conn.room.mcAnswer(conn.player, typeof msg.qid === 'string' ? msg.qid : '', msg.choice);
          conn.send({ t: 'mc_ack', ...r });
          if (r.ok) conn.room.broadcast();
        }
        break;
      case 'answer':
        if (conn.player && conn.room) {
          const r = conn.room.submit(conn.player, msg.text);
          conn.send({
            t: 'ack', ok: r.ok, text: r.text || '', used: conn.room.slotsUsed(conn.player), max: conn.room.maxAnswers(),
            error: r.error, matched: r.matched, duplicate: r.duplicate,
          });
          if (r.ok) conn.room.broadcast();
        }
        break;
      default: break;
    }
  }

  closed(conn) {
    const room = conn.room;
    if (!room) return;
    if (conn.isHost && room.host === conn) { room.host = null; }
    else if (conn.player) room.disconnectPlayer(conn.player, conn);
  }

  tick() {
    const now = Date.now();
    for (const room of this.rooms.values()) room.tick(now);
  }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.touched > ROOM_IDLE_MS && !room.host) this.rooms.delete(code);
    }
  }
}

module.exports = { Game, Room, Database, tierFor, TIER_LABELS, DIFFICULTY, DEFAULT_DIFFICULTY, cleanText };
