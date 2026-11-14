'use strict';
/**
 * Confidence Bets: multiple choice + a 1-5 stake on how sure you are. Trains calibration.
 *
 * SCORING (applied once per question per player at reveal; overconfidence costs the most):
 *   correct = [2, 4, 6, 8, 10][stake-1]
 *   wrong   = [0, -2, -5, -9, -14][stake-1]
 *   no lock-in in time = 0 and counted as unanswered.
 * Stake s means "I think I'm about 20*s % likely to be right" (1 = guessing ... 5 = certain), so the ideal
 * calibration curve is the diagonal 20/40/60/80/100 %. Brier score = mean((0.2*s - outcome)^2), lower is better.
 */
const ASK_MS = 25000;
const REVEAL_MS = 9000;
const TOTAL = 10;
const MIN_BRIER = 6;
const RIGHT_PTS = [2, 4, 6, 8, 10];
const WRONG_PTS = [0, -2, -5, -9, -14];

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

class ConfidenceActivity {
  static meta = {
    type: 'confidence', title: 'Confidence Bets', minPlayers: 1,
    blurb: 'Answer, then stake 1-5 chips on how sure you are. Overconfidence is expensive. Trains calibration.',
    options: [],
  };

  constructor(room) {
    this.room = room;
    this.finished = false;
    this.stage = 'ask';
    this.qNo = 0;
    this.cur = null;
    this.endsAt = 0;
    this.answers = new Map();   // pid -> {pick, stake}   (current question)
    this.results = new Map();   // pid -> {pts, ok, pick, stake} (after reveal)
    this.stats = new Map();     // pid -> {byStake:[{n,right}x5], answered, brierSum, missed}
    this.roomStake = [0, 1, 2, 3, 4].map(() => ({ n: 0, right: 0 }));
    this.revealInfo = null;
    this.final = null;

    if (!(room.usedConfidence instanceof Set)) room.usedConfidence = new Set();
    const bank = (room.db && Array.isArray(room.db.mc) ? room.db.mc : []).filter((q) => q && Array.isArray(q.wrong) && q.wrong.length >= 3 && q.correct != null);
    let fresh = bank.filter((q) => !room.usedConfidence.has(q.id));
    if (fresh.length < Math.min(TOTAL, bank.length)) { room.usedConfidence.clear(); fresh = bank.slice(); }
    this.questions = shuffle(fresh).slice(0, TOTAL);
    this.questions.forEach((q) => room.usedConfidence.add(q.id));
    this.total = this.questions.length;
    if (!this.total) { this.stage = 'done'; this.finished = true; this.computeFinal(); } else this.openQuestion();
  }

  // ---------- flow ----------
  openQuestion() {
    const q = this.questions[this.qNo];
    const opts = shuffle([{ t: str(q.correct, 300), c: true }].concat(q.wrong.slice(0, 3).map((w) => ({ t: str(w, 300), c: false }))));
    this.cur = { q: str(q.q, 800), why: str(q.why, 900), options: opts.map((o) => o.t), correct: opts.findIndex((o) => o.c) };
    this.answers = new Map();
    this.results = new Map();
    this.revealInfo = null;
    this.stage = 'ask';
    this.endsAt = Date.now() + ASK_MS;
  }

  connectedPlayers() { return [...this.room.players.values()].filter((p) => p.connected !== false); }

  statOf(pid) {
    let s = this.stats.get(pid);
    if (!s) { s = { byStake: [0, 1, 2, 3, 4].map(() => ({ n: 0, right: 0 })), answered: 0, brierSum: 0, missed: 0 }; this.stats.set(pid, s); }
    return s;
  }

  reveal() {
    if (this.stage !== 'ask') return;
    const byStake = [0, 1, 2, 3, 4].map(() => ({ n: 0, right: 0 }));
    let answered = 0, right = 0;
    for (const p of this.room.players.values()) {
      const a = this.answers.get(p.id);
      const s = this.statOf(p.id);
      if (!a) { if (p.connected !== false) s.missed++; this.results.set(p.id, { pts: 0, none: true }); continue; }
      const ok = a.pick === this.cur.correct;
      const pts = ok ? RIGHT_PTS[a.stake - 1] : WRONG_PTS[a.stake - 1];
      this.room.addScore(p.id, pts);
      this.results.set(p.id, { pts, ok, pick: a.pick, stake: a.stake });
      s.answered++; s.byStake[a.stake - 1].n++; if (ok) s.byStake[a.stake - 1].right++;
      s.brierSum += (0.2 * a.stake - (ok ? 1 : 0)) ** 2;
      this.roomStake[a.stake - 1].n++; if (ok) this.roomStake[a.stake - 1].right++;
      byStake[a.stake - 1].n++; if (ok) byStake[a.stake - 1].right++;
      answered++; if (ok) right++;
    }
    const total = this.connectedPlayers().length;
    this.revealInfo = { answered, right, unanswered: Math.max(0, total - answered), pct: answered ? Math.round((100 * right) / answered) : null, byStake };
    this.stage = 'reveal';
    this.endsAt = Date.now() + REVEAL_MS;
  }

  advance() {
    if (this.stage !== 'reveal') return;
    this.qNo++;
    if (this.qNo >= this.total) { this.stage = 'done'; this.finished = true; this.endsAt = 0; this.computeFinal(); } else this.openQuestion();
  }

  computeFinal() {
    const curve = this.roomStake.map((c, i) => ({ stake: i + 1, n: c.n, right: c.right, pct: c.n ? Math.round((100 * c.right) / c.n) : null, ideal: 20 * (i + 1) }));
    let take = 'Not enough answers to judge the room.';
    if (curve.some((c) => c.n)) {
      // report the highest stake with enough data that is off by 10+ points (high stakes matter most)
      const g = [...curve].reverse().find((c) => c.n >= 3 && Math.abs(c.pct - c.ideal) >= 10);
      const gap = g ? g.pct - g.ideal : 0;
      const hi = [...curve].reverse().find((c) => c.n >= 3);
      if (g) {
        take = gap < 0
          ? `At stake ${g.stake} the room was right ${g.pct}% of the time (ideal ${g.ideal}%): overconfident.`
          : `At stake ${g.stake} the room was right ${g.pct}% of the time (ideal ${g.ideal}%): underconfident, trust yourselves more.`;
      } else if (hi) take = `At stake ${hi.stake} the room was right ${hi.pct}% of the time (ideal ${hi.ideal}%): well calibrated.`;
    }
    const all = [...this.room.players.values()];
    const top = all.slice().sort((a, b) => b.score - a.score).slice(0, 5).map((p) => ({ name: str(p.name, 30), score: p.score }));
    let best = null;
    for (const p of all) {
      const s = this.stats.get(p.id);
      if (!s || s.answered < MIN_BRIER) continue;
      const b = s.brierSum / s.answered;
      if (!best || b < best.brier) best = { name: str(p.name, 30), brier: Math.round(b * 1000) / 1000, answered: s.answered };
    }
    this.final = { curve, takeaway: take, top, best };
  }

  // ---------- contract ----------
  hostView() {
    const base = { stage: this.stage, n: Math.min(this.qNo + 1, this.total), total: this.total };
    if (this.stage === 'ask') {
      const conn = this.connectedPlayers();
      return { ...base, q: this.cur.q, options: this.cur.options, endsInMs: Math.max(0, this.endsAt - Date.now()), locked: conn.filter((p) => this.answers.has(p.id)).length, connected: conn.length };
    }
    if (this.stage === 'reveal') {
      return { ...base, q: this.cur.q, options: this.cur.options, correct: this.cur.correct, why: this.cur.why, endsInMs: Math.max(0, this.endsAt - Date.now()), ...this.revealInfo };
    }
    return { ...base, ...this.final };
  }

  playerView(pid) {
    const base = { stage: this.stage, n: Math.min(this.qNo + 1, this.total), total: this.total };
    const me = this.room.players.get(pid);
    const score = me ? me.score : 0;
    if (this.stage === 'ask') {
      const a = this.answers.get(pid);
      return { ...base, q: this.cur.q, options: this.cur.options, endsInMs: Math.max(0, this.endsAt - Date.now()), locked: !!a, pick: a ? a.pick : null, stake: a ? a.stake : null, score };
    }
    if (this.stage === 'reveal') {
      const r = this.results.get(pid) || { pts: 0, none: true };
      return { ...base, q: this.cur.q, options: this.cur.options, correct: this.cur.correct, why: this.cur.why, endsInMs: Math.max(0, this.endsAt - Date.now()),
        result: r.none ? 'none' : r.ok ? 'right' : 'wrong', pts: r.pts, pick: r.pick == null ? null : r.pick, stake: r.stake || null, score };
    }
    const s = this.statOf(pid);
    const ranked = [...this.room.players.values()].sort((a, b) => b.score - a.score);
    const rank = ranked.findIndex((p) => p.id === pid) + 1;
    const byStake = s.byStake.map((c, i) => ({ stake: i + 1, n: c.n, right: c.right, pct: c.n ? Math.round((100 * c.right) / c.n) : null }));
    return { ...base, byStake, answered: s.answered, missed: s.missed, coaching: this.coach(s), rank, players: ranked.length, score };
  }

  coach(s) {
    if (s.answered < 3) return 'Answer more questions to see how well your confidence matches your results.';
    const hn = s.byStake[3].n + s.byStake[4].n, hr = s.byStake[3].right + s.byStake[4].right;
    const ln = s.byStake[0].n + s.byStake[1].n, lr = s.byStake[0].right + s.byStake[1].right;
    if (hn >= 2 && hr / hn < 0.7) return `Your high-confidence picks were right only ${Math.round((100 * hr) / hn)}% of the time: save stakes 4-5 for answers you can defend.`;
    if (ln >= 2 && lr / ln > 0.6) return `Your low-stake picks were right ${Math.round((100 * lr) / ln)}% of the time: you know more than you think, bet bigger.`;
    return 'Your confidence tracked your accuracy well. Keep betting big only when you are sure.';
  }

  handle(player, d) {
    if (!d || typeof d !== 'object' || d.a !== 'lock') return { ok: false, error: 'bad' };
    if (this.stage !== 'ask') return { ok: false, error: 'stage' };
    if (Date.now() > this.endsAt) return { ok: false, error: 'late' };
    const { pick, stake } = d;
    if (!Number.isInteger(pick) || pick < 0 || pick > 3) return { ok: false, error: 'pick' };
    if (!Number.isInteger(stake) || stake < 1 || stake > 5) return { ok: false, error: 'stake' };
    if (this.answers.has(player.id)) return { ok: false, error: 'already' };
    this.answers.set(player.id, { pick, stake });
    return { ok: true };
  }

  hostCommand(cmd) {
    if (cmd !== 'next') return;
    if (this.stage === 'ask') this.reveal();
    else if (this.stage === 'reveal') this.advance();
  }

  tick() {
    const now = Date.now();
    if (this.stage === 'ask') {
      const conn = this.connectedPlayers();
      const allIn = conn.length > 0 && conn.every((p) => this.answers.has(p.id));
      if (allIn || now >= this.endsAt) { this.reveal(); return true; }
    } else if (this.stage === 'reveal' && now >= this.endsAt) { this.advance(); return true; }
    return false;
  }
}
module.exports = ConfidenceActivity;
