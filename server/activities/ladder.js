'use strict';
/**
 * Confidence Ladder: everyone climbs the same 10-step ladder together.
 * Rules and interpretations are documented at the top of tests/activity_ladder.test.js.
 */

const PRIZES = [5, 10, 15, 25, 40, 60, 80, 100, 125, 150];
const SAFE = [3, 6]; // steps whose prize is guaranteed once cleared
const STEPS = PRIZES.length;
const LIFELINES = ['fifty', 'room', 'senior'];
const DEFAULT_ASK_MS = 30000;
const DEFAULT_REVEAL_MS = 10000;

function envMs(name, def) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 200 && n <= 120000 ? n : def;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Prize guaranteed after clearing `completed` steps (last safe haven passed). */
function safePrize(completed) {
  let p = 0;
  for (const s of SAFE) if (completed >= s) p = PRIZES[s - 1];
  return p;
}
const bankedPrize = (completed) => (completed > 0 ? PRIZES[completed - 1] : 0);

class LadderActivity {
  static meta = {
    type: 'ladder',
    title: 'Confidence Ladder',
    blurb: 'Everyone climbs a 10-step ladder together: lock in, use a lifeline, or walk away with your points.',
    minPlayers: 1,
    key: 'L',
    options: [],
  };

  constructor(room) {
    this.room = room;
    this.askMs = envMs('ZEBRA_LADDER_ASK_MS', DEFAULT_ASK_MS);
    this.revealMs = envMs('ZEBRA_LADDER_REVEAL_MS', DEFAULT_REVEAL_MS);
    if (!(room.usedLadder instanceof Set)) room.usedLadder = new Set();
    this.pl = new Map(); // pid -> {status, completed, final, lifelines, result}
    this.stage = 'ask';
    this.step = 0;
    this.q = null; // {id,q,options:[str],correct,why,level}
    this.lock = new Map(); // pid -> option index (current question)
    this.lr = new Map(); // pid -> lifeline results (current question)
    this.asked = new Set(); // pids climbing when the question opened
    this.deadline = 0;
    this.revealEnds = 0;
    this.pct = [0, 0, 0, 0];
    this.noAnswer = 0;
    this.awarded = false;
    this.finished = false;
    this.winnings = [];
    this.sync();
    if (!this.nextQuestion()) this.finish();
  }

  // ---------- players ----------
  fresh(status) {
    return { status, completed: 0, final: 0, lifelines: { fifty: false, room: false, senior: false }, result: null };
  }

  /** Register players we have not seen. Joining is only possible while still at step 1 of the ask. */
  sync() {
    let changed = false;
    for (const p of this.room.players.values()) {
      if (this.pl.has(p.id)) continue;
      const canClimb = this.stage === 'ask' && this.step <= 1;
      this.pl.set(p.id, this.fresh(canClimb ? 'climbing' : 'spectator'));
      if (canClimb) this.asked.add(p.id);
      changed = true;
    }
    return changed;
  }

  climbing() {
    const out = [];
    for (const [pid, s] of this.pl) if (s.status === 'climbing' && this.room.players.has(pid)) out.push(pid);
    return out;
  }

  // ---------- questions ----------
  levelOf(q) { return q.level >= 1 && q.level <= 10 ? q.level : 5; }

  pickQuestion(step) {
    const bank = (this.room.db && this.room.db.mc) || [];
    const unused = bank.filter((q) => !this.room.usedLadder.has(q.id));
    if (!unused.length) return null;
    for (let off = 0; off < STEPS; off++) {
      for (const lv of off === 0 ? [step] : [step + off, step - off]) {
        if (lv < 1 || lv > STEPS) continue;
        const c = unused.filter((q) => this.levelOf(q) === lv);
        if (c.length) return c[Math.floor(Math.random() * c.length)];
      }
    }
    return unused[0];
  }

  nextQuestion() {
    const step = this.step + 1;
    const raw = step <= STEPS ? this.pickQuestion(step) : null;
    if (!raw) return false;
    this.room.usedLadder.add(raw.id);
    const opts = shuffle([{ t: raw.correct, c: true }, ...raw.wrong.map((t) => ({ t, c: false }))]);
    this.step = step;
    this.q = { id: raw.id, q: raw.q, options: opts.map((o) => o.t), correct: opts.findIndex((o) => o.c), why: raw.why || '', level: raw.level };
    this.lock = new Map();
    this.lr = new Map();
    this.asked = new Set(this.climbing());
    this.stage = 'ask';
    this.deadline = Date.now() + this.askMs;
    this.pct = [0, 0, 0, 0];
    return true;
  }

  // ---------- resolution ----------
  allActed() {
    const live = this.climbing();
    if (!live.length) return true;
    let connected = 0;
    for (const pid of live) {
      const p = this.room.players.get(pid);
      if (p && p.connected !== false) { connected++; if (!this.lock.has(pid)) return false; }
    }
    return connected > 0; // all climbers offline: wait out the timer
  }

  resolve() {
    if (this.stage !== 'ask') return;
    const counts = [0, 0, 0, 0];
    let none = 0;
    for (const pid of this.asked) {
      const s = this.pl.get(pid);
      if (!s) continue;
      if (this.lock.has(pid)) counts[this.lock.get(pid)]++;
      else if (s.status === 'climbing') none++;
      else if (s.status === 'walked' && s.walkStep === this.step) none++;
    }
    const total = counts.reduce((a, b) => a + b, 0); // percent of players who locked in
    this.pct = counts.map((c) => (total ? Math.round((c / total) * 100) : 0));
    this.noAnswer = none;
    for (const pid of this.climbing()) {
      const s = this.pl.get(pid);
      if (this.lock.get(pid) === this.q.correct) {
        s.completed = this.step;
        s.result = 'right';
        if (this.step >= STEPS) { s.status = 'top'; s.final = PRIZES[STEPS - 1]; }
      } else {
        s.result = this.lock.has(pid) ? 'wrong' : 'timeout';
        s.status = 'fell';
        s.final = safePrize(s.completed);
      }
    }
    for (const [pid, s] of this.pl) if (s.status !== 'climbing' && s.result === null && s.status !== 'spectator') s.result = s.status;
    this.stage = 'reveal';
    this.revealEnds = Date.now() + this.revealMs;
  }

  advance() {
    if (this.stage !== 'reveal') return;
    if (!this.climbing().length || !this.nextQuestion()) this.finish();
  }

  finish() {
    this.stage = 'done';
    this.finished = true;
    if (this.awarded) return;
    this.awarded = true;
    for (const [pid, s] of this.pl) {
      if (s.status === 'climbing') { s.status = 'fell'; s.final = safePrize(s.completed); }
      if (s.final > 0) this.room.addScore(pid, s.final);
    }
    this.winnings = [...this.pl.entries()]
      .filter(([pid, s]) => this.room.players.has(pid) && s.status !== 'spectator')
      .map(([pid, s]) => ({ id: pid, name: this.room.players.get(pid).name, points: s.final, completed: s.completed, status: s.status }))
      .sort((a, b) => b.points - a.points || b.completed - a.completed || a.name.localeCompare(b.name));
  }

  // ---------- input ----------
  handle(player, d) {
    this.sync();
    if (!d || typeof d !== 'object') return { ok: false, error: 'Bad request.' };
    const s = this.pl.get(player && player.id);
    if (!s) return { ok: false, error: 'You are not in this game.' };
    if (this.stage !== 'ask') return { ok: false, error: 'Wait for the next question.' };
    if (s.status !== 'climbing') return { ok: false, error: 'Your run is over. Enjoy watching.' };
    if (this.lock.has(player.id)) return { ok: false, error: 'You already locked in.' };
    if (Date.now() >= this.deadline) return { ok: false, error: 'Time is up.' };

    if (d.lock !== undefined) {
      const i = d.lock;
      if (!Number.isInteger(i) || i < 0 || i > 3) return { ok: false, error: 'Pick one of the four options.' };
      this.lock.set(player.id, i);
      if (this.allActed()) this.resolve();
      return { ok: true, lock: i };
    }
    if (d.walk === true) {
      s.status = 'walked';
      s.final = bankedPrize(s.completed);
      s.walkStep = this.step;
      s.result = 'walked';
      if (this.allActed()) this.resolve();
      return { ok: true, walk: true, points: s.final };
    }
    if (typeof d.lifeline === 'string') {
      const name = d.lifeline;
      if (!LIFELINES.includes(name)) return { ok: false, error: 'Unknown lifeline.' };
      if (s.lifelines[name]) return { ok: false, error: 'Lifeline already used.' };
      const res = this.useLifeline(player.id, name);
      s.lifelines[name] = true;
      const mine = this.lr.get(player.id) || {};
      mine[name] = res;
      this.lr.set(player.id, mine);
      return { ok: true, lifeline: name, result: res };
    }
    return { ok: false, error: 'Unknown action.' };
  }

  useLifeline(pid, name) {
    if (name === 'fifty') {
      const wrong = shuffle([0, 1, 2, 3].filter((i) => i !== this.q.correct)).slice(0, 2).sort();
      return { hide: wrong };
    }
    const others = this.climbing().filter((id) => id !== pid && this.lock.has(id) && this.room.players.get(id).connected !== false);
    if (name === 'room') {
      const counts = [0, 0, 0, 0];
      for (const id of others) counts[this.lock.get(id)]++;
      const n = others.length;
      const pct = counts.map((c) => (n ? Math.round((c / n) * 100) : 0));
      return { pct, n, note: n < 3 ? (n === 0 ? 'Nobody else has locked in yet.' : `Only ${n} other${n === 1 ? ' has' : 's have'} locked in so far.`) : '' };
    }
    // senior
    if (!others.length) return { none: true };
    const { rank } = this.room.ranks();
    others.sort((a, b) => (rank.get(a) || 999) - (rank.get(b) || 999));
    return { option: this.lock.get(others[0]), rank: rank.get(others[0]) || null };
  }

  hostCommand(cmd) {
    if (cmd !== 'next') return;
    if (this.stage === 'ask') this.resolve();
    else if (this.stage === 'reveal') this.advance();
  }

  tick(now) {
    let changed = this.sync();
    now = now || Date.now();
    if (this.stage === 'ask' && (now >= this.deadline || this.allActed())) { this.resolve(); changed = true; }
    else if (this.stage === 'reveal' && now >= this.revealEnds) { this.advance(); changed = true; }
    return changed;
  }

  // ---------- views ----------
  ladderCounts() {
    const counts = new Array(STEPS + 1).fill(0); // index = completed rungs (0 = start)
    for (const [pid, s] of this.pl) {
      if (s.status === 'spectator' || !this.room.players.has(pid)) continue;
      counts[s.completed]++;
    }
    return counts;
  }

  reached() {
    const out = [];
    for (let k = 1; k <= STEPS; k++) {
      let n = 0;
      for (const [pid, s] of this.pl) if (s.status !== 'spectator' && this.room.players.has(pid) && s.completed >= k) n++;
      out.push(n);
    }
    return out;
  }

  base() {
    const ends = this.stage === 'ask' ? this.deadline : this.stage === 'reveal' ? this.revealEnds : 0;
    const n = this.climbing().length;
    return {
      stage: this.stage, step: this.step, steps: STEPS, prizes: PRIZES, safe: SAFE,
      endsInMs: ends ? Math.max(0, ends - Date.now()) : 0,
      climbing: n,
      ladder: this.ladderCounts(),
    };
  }

  hostView() {
    this.sync();
    const v = this.base();
    if (this.stage === 'ask') {
      v.q = this.q.q; v.options = this.q.options; v.level = this.q.level || 0;
      v.locked = this.climbing().filter((id) => this.lock.has(id)).length;
    } else if (this.stage === 'reveal') {
      v.q = this.q.q; v.options = this.q.options; v.correct = this.q.correct; v.why = this.q.why;
      v.pct = this.pct; v.noAnswer = this.noAnswer; v.asked = this.asked.size;
    } else {
      v.winnings = this.winnings.slice(0, 12); v.reached = this.reached(); v.players = this.winnings.length;
    }
    return v;
  }

  playerView(pid) {
    this.sync();
    const v = this.base();
    const s = this.pl.get(pid) || this.fresh('spectator');
    v.me = {
      status: s.status, completed: s.completed, banked: bankedPrize(s.completed), safePoints: safePrize(s.completed),
      final: s.status === 'climbing' ? null : s.final, lifelines: { ...s.lifelines }, result: s.result,
      walkPoints: bankedPrize(s.completed),
    };
    if (this.stage === 'ask') {
      v.q = this.q.q; v.options = this.q.options;
      v.me.locked = this.lock.has(pid) ? this.lock.get(pid) : null;
      v.me.lifeResults = this.lr.get(pid) || {};
      v.locked = this.climbing().filter((id) => this.lock.has(id)).length;
    } else if (this.stage === 'reveal') {
      v.q = this.q.q; v.options = this.q.options; v.correct = this.q.correct; v.why = this.q.why;
      v.me.locked = this.lock.has(pid) ? this.lock.get(pid) : null;
      v.pct = this.pct;
      v.me.lifeResults = this.lr.get(pid) || {};
    } else {
      v.winnings = this.winnings.slice(0, 10); v.reached = this.reached(); v.players = this.winnings.length;
      v.me.won = s.final;
    }
    return v;
  }
}

module.exports = LadderActivity;
