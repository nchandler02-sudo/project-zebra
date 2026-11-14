'use strict';
/**
 * Medical Chopped: a case is revealed in four stages; after each stage players write up to 3 diagnoses.
 * The lowest cumulative scorers are "chopped" between stages; survivors reach the final reveal.
 *
 * SCORING per stage (max 3 entries, duplicates count once, unmatched = 0):
 *   matched item  -> its points if stage index >= item.from_stage, else round(points / 2) (a lucky early guess)
 *   +3 bonus once per stage if at least one matched item is a must-not-miss item.
 * CHOPS: after stage indexes 0 and 1, and after index 2 only when 5+ survivors remain, and only when 4+ players
 * are connected. All players tied for lowest cumulative score are chopped, but only if 3+ survivors remain.
 * LEADERBOARD (room.addScore): chopped players get their cumulative score when chopped; survivors get theirs once
 * at the reveal; the champion(s) with the top cumulative score among survivors get +20.
 */
const fs = require('fs');
const path = require('path');
const { PromptMatcher } = require('../matcher');

const THINK_MS = Math.max(1000, Number(process.env.ZEBRA_CHOPPED_MS) || 60000);
const MAX_ENTRIES = 3;
const MAX_LEN = 80;
const BONUS = 3;
const CHAMPION_PTS = 20;
const MIN_PLAYERS_FOR_CHOP = 4;
const MIN_SURVIVORS_AFTER = 3;
const MIN_SURVIVORS_STAGE3 = 5;

let CACHE = null;
function loadCases() {
  if (CACHE) return CACHE;
  const file = path.join(__dirname, '..', '..', 'data', 'chopped_cases.json');
  let cases = [];
  try { cases = JSON.parse(fs.readFileSync(file, 'utf8')).cases || []; } catch (e) { console.error('[chopped] cannot load cases: ' + e.message); }
  CACHE = cases.filter((c) => c && Array.isArray(c.stages) && c.stages.length === 4 && Array.isArray(c.differential) && c.differential.length)
    .map((c) => ({ ...c, matcher: new PromptMatcher({ answers: c.differential.map((d) => ({ name: d.name, aliases: d.aliases || [] })) }) }));
  return CACHE;
}

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const clean = (v) => str(v, 400).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);

/** Score a list of entry strings at a stage index against a case. Pure, exported for tests. */
function scoreEntries(c, entries, stageIdx) {
  const seen = new Set();
  const items = [];
  let score = 0, mnm = false;
  for (const text of entries) {
    const r = c.matcher.match(text);
    if (!r.matched) { items.push({ text, idx: -1, name: null, pts: 0 }); continue; }
    if (seen.has(r.index)) { items.push({ text, idx: r.index, name: c.differential[r.index].name, pts: 0, dup: true }); continue; }
    seen.add(r.index);
    const d = c.differential[r.index];
    const early = stageIdx < d.from_stage;
    const pts = early ? Math.round(d.points / 2) : d.points;
    score += pts;
    if (d.kind === 'must-not-miss') mnm = true;
    items.push({ text, idx: r.index, name: d.name, pts, early });
  }
  const bonus = mnm ? BONUS : 0;
  return { items, score: score + bonus, bonus };
}

class ChoppedActivity {
  static meta = {
    type: 'chopped', title: 'Medical Chopped', minPlayers: 2,
    blurb: 'A case unfolds in four stages. Write your differential after each one; the lowest scorers get chopped. Survivors reach the final reveal.',
    options: [],
  };

  constructor(room, opts) {
    this.room = room;
    this.finished = false;
    this.opts = opts || {};
    this.startCase(typeof this.opts.caseId === 'string' ? this.opts.caseId : null);
  }

  // ---------- flow ----------
  startCase(wantedId) {
    const all = loadCases();
    this.roster = new Map();
    this.subs = new Map();
    this.stageRes = null;
    this.chopNames = null;
    this.ranking = [];
    this.choppedList = [];
    this.champions = [];
    this.bestList = [];
    if (!all.length) { this.c = null; this.stage = 'done'; this.finished = true; return; }
    if (!(this.room.choppedUsed instanceof Set)) this.room.choppedUsed = new Set();
    let c = wantedId ? all.find((x) => x.id === wantedId) : null;
    if (!c) {
      let fresh = all.filter((x) => !this.room.choppedUsed.has(x.id));
      if (!fresh.length) { this.room.choppedUsed.clear(); fresh = all; }
      c = fresh[Math.floor(Math.random() * fresh.length)];
    }
    this.room.choppedUsed.add(c.id);
    this.c = c;
    this.finished = false;
    this.stageIdx = 0;
    for (const p of this.room.players.values()) if (p.connected !== false) this.addToRoster(p.id);
    this.openThink();
  }

  addToRoster(pid) {
    if (!this.roster.has(pid)) this.roster.set(pid, { cum: 0, chopped: false, choppedAt: -1, choppedScore: 0, hist: [], awarded: 0 });
  }

  openThink() {
    this.stage = 'think';
    this.subs = new Map();
    this.stageRes = null;
    this.chopNames = null;
    this.endsAt = Date.now() + THINK_MS;
  }

  alive() { return [...this.roster.entries()].filter(([, r]) => !r.chopped).map(([pid]) => pid); }
  connectedCount() { return [...this.room.players.values()].filter((p) => p.connected !== false).length; }
  nameOf(pid) { const p = this.room.players.get(pid); return p ? str(p.name, 30) : 'Player'; }
  isConnected(pid) { const p = this.room.players.get(pid); return !!p && p.connected !== false; }

  resolveStage() {
    if (this.stage !== 'think') return;
    const c = this.c, s = this.stageIdx;
    const counts = new Map();
    let other = 0, submitted = 0;
    for (const pid of this.alive()) {
      const r = this.roster.get(pid);
      const entries = this.subs.get(pid) || [];
      const res = scoreEntries(c, entries, s);
      r.hist[s] = { items: res.items, score: res.score, bonus: res.bonus };
      r.cum += res.score;
      if (entries.length) submitted++;
      for (const it of res.items) {
        if (it.dup) continue;
        if (it.idx < 0) other++; else counts.set(it.idx, (counts.get(it.idx) || 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 6).map(([i, n]) => ({ name: c.differential[i].name, count: n }));
    this.stageRes = { top, other, submitted };

    // chop decision
    this.chopNames = null;
    const alive = this.alive();
    const chopAllowed = (s <= 1 || (s === 2 && alive.length >= MIN_SURVIVORS_STAGE3)) && this.connectedCount() >= MIN_PLAYERS_FOR_CHOP;
    if (chopAllowed && alive.length) {
      const low = Math.min(...alive.map((pid) => this.roster.get(pid).cum));
      const tied = alive.filter((pid) => this.roster.get(pid).cum === low);
      if (alive.length - tied.length >= MIN_SURVIVORS_AFTER) {
        for (const pid of tied) {
          const r = this.roster.get(pid);
          r.chopped = true; r.choppedAt = s; r.choppedScore = r.cum;
          this.room.addScore(pid, r.cum);
          r.awarded += r.cum;
        }
        this.chopNames = tied.map((pid) => ({ name: this.nameOf(pid), score: this.roster.get(pid).cum }));
      }
    }
    this.stage = 'result';
    this.endsAt = 0;
  }

  toReveal() {
    const surv = this.alive();
    const top = surv.length ? Math.max(...surv.map((pid) => this.roster.get(pid).cum)) : 0;
    this.champions = surv.filter((pid) => this.roster.get(pid).cum === top);
    for (const pid of surv) {
      const r = this.roster.get(pid);
      let pts = r.cum;
      if (this.champions.includes(pid)) pts += CHAMPION_PTS;
      this.room.addScore(pid, pts);
      r.awarded += pts;
    }
    this.bestList = surv.map((pid) => {
      const r = this.roster.get(pid);
      let bi = 0;
      r.hist.forEach((h, i) => { if (h && h.score > (r.hist[bi] ? r.hist[bi].score : -1)) bi = i; });
      return { name: this.nameOf(pid), stage: this.c.stages[bi].label, stageNo: bi + 1, score: r.hist[bi] ? r.hist[bi].score : 0 };
    });
    this.ranking = surv.map((pid) => ({ pid, name: this.nameOf(pid), score: this.roster.get(pid).cum, champion: this.champions.includes(pid) }))
      .sort((a, b) => b.score - a.score);
    this.choppedList = [...this.roster.entries()].filter(([, r]) => r.chopped).map(([pid, r]) => ({ name: this.nameOf(pid), score: r.choppedScore, at: r.choppedAt + 1 }));
    this.stage = 'reveal';
  }

  hostCommand(cmd) {
    if (cmd !== 'next' || !this.c) return;
    if (this.stage === 'think') this.resolveStage();
    else if (this.stage === 'result') { if (this.stageIdx < 3) { this.stageIdx++; this.openThink(); } else this.toReveal(); }
    else if (this.stage === 'reveal') { this.stage = 'done'; this.finished = true; this.endsAt = 0; }
    else if (this.stage === 'done') this.startCase(null);
  }

  tick(now) {
    if (this.stage === 'think' && now >= this.endsAt) { this.resolveStage(); return true; }
    return false;
  }

  /** Players who join while stage 1 is still being written are dealt in; later joiners only watch. */
  dealIn(pid) {
    if (this.c && this.stage === 'think' && this.stageIdx === 0 && this.room.players.has(pid)) this.addToRoster(pid);
  }

  onPlayerJoin(p) { if (p && p.id) this.dealIn(p.id); }

  // ---------- input ----------
  handle(player, d) {
    if (!d || typeof d !== 'object' || d.a !== 'submit') return { ok: false, error: 'bad' };
    if (this.stage !== 'think') return { ok: false, error: 'stage' };
    if (Date.now() > this.endsAt) return { ok: false, error: 'late' };
    this.dealIn(player.id);
    const r = this.roster.get(player.id);
    if (!r) return { ok: false, error: 'watching' };
    if (r.chopped) return { ok: false, error: 'chopped' };
    if (!Array.isArray(d.entries)) return { ok: false, error: 'bad' };
    if (d.entries.length > MAX_ENTRIES) return { ok: false, error: 'too_many' };
    const out = [];
    for (const e of d.entries) {
      if (typeof e !== 'string') return { ok: false, error: 'bad' };
      const t = clean(e);
      if (t) out.push(t);
    }
    if (out.length) this.subs.set(player.id, out); else this.subs.delete(player.id);
    return { ok: true, n: out.length, entries: out };
  }

  // ---------- views ----------
  stagesShown() { return this.c.stages.slice(0, this.stageIdx + 1).map((s) => ({ label: str(s.label, 40), text: str(s.text, 800) })); }
  stagesAll() { return this.c.stages.map((s) => ({ label: str(s.label, 40), text: str(s.text, 800) })); }

  baseView() {
    const alive = this.alive();
    return {
      stage: this.stage, title: str(this.c.title, 120), stageIdx: this.stageIdx, stageCount: 4,
      stages: this.stagesShown(), alive: alive.length, players: this.roster.size,
      chopped: this.roster.size - alive.length,
    };
  }

  leaders() {
    return this.alive().map((pid) => ({ name: this.nameOf(pid), score: this.roster.get(pid).cum, stageScore: (this.roster.get(pid).hist[this.stageIdx] || {}).score || 0 }))
      .sort((a, b) => b.score - a.score).slice(0, 5);
  }

  fullDx() { return this.c.differential.map((d) => ({ name: d.name, kind: d.kind, points: d.points, from: d.from_stage + 1 })).sort((a, b) => b.points - a.points); }

  hostView() {
    if (!this.c) return { stage: 'done', title: 'No cases available', ranking: [], chopList: [], stages: [], differential: [] };
    const base = this.baseView();
    if (this.stage === 'think') {
      const alive = this.alive();
      return { ...base, endsInMs: Math.max(0, this.endsAt - Date.now()), submitted: alive.filter((pid) => this.subs.has(pid)).length, expected: alive.filter((pid) => this.isConnected(pid)).length };
    }
    if (this.stage === 'result') {
      return { ...base, top: this.stageRes.top, other: this.stageRes.other, leaders: this.leaders(), chop: this.chopNames, last: this.stageIdx >= 3 };
    }
    const reveal = { ...base, stages: this.stagesAll(), diagnosis: str(this.c.diagnosis, 120), differential: this.fullDx(), best: this.bestList, teaching: str(this.c.teaching, 1500), champions: this.ranking.filter((r) => r.champion).map((r) => r.name) };
    if (this.stage === 'reveal') return reveal;
    return { ...reveal, ranking: this.ranking.map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, champion: r.champion })), chopList: this.choppedList };
  }

  playerView(pid) {
    if (!this.c) return { stage: 'done', title: 'No cases available', stages: [], differential: [] };
    this.dealIn(pid);
    const base = this.baseView();
    const r = this.roster.get(pid);
    const status = !r ? 'watching' : r.chopped ? 'chopped' : 'alive';
    const me = { status, cum: r ? (r.chopped ? r.choppedScore : r.cum) : 0 };
    if (this.stage === 'think') {
      return { ...base, ...me, endsInMs: Math.max(0, this.endsAt - Date.now()), entries: this.subs.get(pid) || [], saved: this.subs.has(pid), max: MAX_ENTRIES, maxLen: MAX_LEN };
    }
    const hist = r && r.hist[this.stageIdx] ? r.hist[this.stageIdx] : null;
    if (this.stage === 'result') {
      return { ...base, ...me, top: this.stageRes.top, other: this.stageRes.other, chop: this.chopNames,
        justChopped: !!(r && r.chopped && r.choppedAt === this.stageIdx), choppedAt: r && r.chopped ? r.choppedAt + 1 : 0,
        stageScore: hist ? hist.score : 0, bonus: hist ? hist.bonus : 0,
        mine: hist ? hist.items.map((i) => ({ text: i.text, name: i.name, pts: i.pts, dup: !!i.dup, early: !!i.early })) : [], last: this.stageIdx >= 3 };
    }
    const mineBest = status === 'alive' ? (this.bestList.find((b) => b.name === this.nameOf(pid)) || null) : null;
    const common = { ...base, ...me, stages: this.stagesAll(), diagnosis: str(this.c.diagnosis, 120), differential: this.fullDx(), teaching: str(this.c.teaching, 1500), mineBest, champion: !!(r && this.champions.includes(pid)) };
    if (this.stage === 'reveal') return { ...common, best: this.bestList };
    const idx = this.ranking.findIndex((x) => x.pid === pid);
    return { ...common, rank: idx >= 0 ? idx + 1 : 0, survivors: this.ranking.length, awarded: r ? r.awarded : 0, ranking: this.ranking.slice(0, 5).map((x, i) => ({ rank: i + 1, name: x.name, score: x.score, champion: x.champion })) };
  }
}

ChoppedActivity.scoreEntries = scoreEntries;
module.exports = ChoppedActivity;
