'use strict';
/**
 * Clue Ladder: a diagnosis is revealed through 4 clues of increasing ease. The earlier you name it, the more points.
 * Run = 5 cases. Stages: 'play' (view.clueIndex 0-3), 'reveal', 'done'.
 */
const fs = require('fs');
const path = require('path');
const { PromptMatcher } = require('../matcher');

const DATA_PATH = path.join(__dirname, '..', '..', 'data', 'clue_cases.json');
const POINTS = [10, 7, 4, 2];
const CASES_PER_RUN = 5;
const MAX_WRONG = 3;
const MAX_GUESS_LEN = 80;
const OFFENSIVE = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'nigg', 'fag', 'retard', 'whore', 'slut', 'penis', 'vagina', 'porn', 'sex'];

let cache = null; // { cases: [...], matchers: Map }
function load() {
  if (cache) return cache;
  let cases = [];
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    cases = (raw.cases || []).filter((c) => c && c.id && c.diagnosis && Array.isArray(c.clues) && c.clues.length === 4);
  } catch (e) {
    console.error('[clueladder] could not load clue_cases.json:', e.message);
  }
  cache = { cases, matchers: new Map() };
  return cache;
}
function matcherFor(c) {
  const { matchers } = load();
  if (!matchers.has(c.id)) matchers.set(c.id, new PromptMatcher({ answers: [{ name: c.diagnosis, aliases: c.aliases || [] }] }));
  return matchers.get(c.id);
}
function envMs(name, dflt) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}
function isOffensive(s) {
  return OFFENSIVE.some((w) => s.includes(w));
}

class ClueLadderActivity {
  constructor(room, opts) {
    this.room = room;
    this.clueMs = envMs('ZEBRA_CLUE_MS', 15000);
    this.revealMs = envMs('ZEBRA_REVEAL_MS', 20000);
    const { cases } = load();
    if (!room.__clueUsed) room.__clueUsed = new Set();
    let pool = cases.filter((c) => !room.__clueUsed.has(c.id));
    if (pool.length < CASES_PER_RUN) { room.__clueUsed.clear(); pool = cases.slice(); }
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    this.cases = pool.slice(0, CASES_PER_RUN);
    for (const c of this.cases) room.__clueUsed.add(c.id);
    this.runScore = new Map(); // pid -> points earned in this run
    this.finished = false;
    this.changed = false;
    this.caseNo = -1;
    this.startCase(0);
  }

  get cur() { return this.cases[this.caseNo]; }

  startCase(n) {
    this.caseNo = n;
    this.stage = 'play';
    this.clueIndex = 0;
    this.deadline = Date.now() + this.clueMs;
    this.solved = new Map(); // pid -> {clue, pts}
    this.guesses = new Map(); // pid -> {wrong:number, tried:Set<normalized>}
    this.wrongCounts = new Map(); // normalized -> count
    this.commonWrong = [];
    this.solverNames = [];
  }

  active() {
    return [...this.room.players.values()].filter((p) => p.connected !== false);
  }
  guessState(pid) {
    let g = this.guesses.get(pid);
    if (!g) { g = { wrong: 0, tried: new Set() }; this.guesses.set(pid, g); }
    return g;
  }
  statusOf(pid) {
    if (this.solved.has(pid)) return 'solved';
    return this.guessState(pid).wrong >= MAX_WRONG ? 'out' : 'guessing';
  }
  counts() {
    const act = this.active();
    let solved = 0; let guessing = 0;
    for (const p of act) {
      const s = this.statusOf(p.id);
      if (s === 'solved') solved++; else if (s === 'guessing') guessing++;
    }
    return { solved, guessing, total: act.length };
  }

  toReveal() {
    this.stage = 'reveal';
    this.deadline = Date.now() + this.revealMs;
    const top = [...this.wrongCounts.entries()].filter(([s, n]) => n >= 2 && !isOffensive(s)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3);
    this.commonWrong = top.map(([guess, count]) => ({ guess, count }));
    this.solverNames = [...this.solved.entries()].map(([pid, s]) => {
      const p = this.room.players.get(pid);
      return { name: p ? p.name : '?', clue: s.clue, pts: s.pts };
    }).sort((a, b) => a.clue - b.clue);
  }

  nextCase() {
    if (this.caseNo + 1 >= this.cases.length) {
      this.stage = 'done';
      this.finished = true;
      this.deadline = 0;
    } else this.startCase(this.caseNo + 1);
  }

  checkAllDone() {
    if (this.stage !== 'play') return false;
    const c = this.counts();
    if (c.total > 0 && c.guessing === 0) { this.toReveal(); return true; }
    return false;
  }

  tick() {
    const now = Date.now();
    if (this.stage === 'play') {
      if (this.checkAllDone()) return true;
      if (now >= this.deadline) {
        if (this.clueIndex < 3) {
          this.clueIndex++;
          this.deadline += this.clueMs;
          if (this.deadline <= now) this.deadline = now + this.clueMs;
        } else this.toReveal();
        return true;
      }
    } else if (this.stage === 'reveal' && now >= this.deadline) {
      this.nextCase();
      return true;
    }
    return false;
  }

  hostCommand(cmd) {
    if (cmd !== 'next') return;
    if (this.stage === 'play') this.toReveal();
    else if (this.stage === 'reveal') this.nextCase();
  }

  onPlayerJoin() { /* late joiners just see the current state */ }

  handle(player, d) {
    if (!d || typeof d !== 'object' || d.k !== 'guess') return { ok: false, msg: 'Invalid request.' };
    if (this.stage !== 'play') return { ok: false, msg: 'No guessing right now.' };
    if (typeof d.text !== 'string') return { ok: false, msg: 'Type a diagnosis.' };
    const text = d.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!text) return { ok: false, msg: 'Type a diagnosis.' };
    if (text.length > MAX_GUESS_LEN) return { ok: false, msg: 'That is too long (80 characters max).' };
    const pid = player.id;
    if (this.solved.has(pid)) return { ok: false, msg: 'You already solved this one.' };
    const g = this.guessState(pid);
    if (g.wrong >= MAX_WRONG) return { ok: false, msg: 'Out of guesses for this case.' };

    const m = matcherFor(this.cur).match(text);
    if (m.matched) {
      const pts = POINTS[this.clueIndex];
      this.solved.set(pid, { clue: this.clueIndex, pts });
      this.runScore.set(pid, (this.runScore.get(pid) || 0) + pts);
      this.room.addScore(pid, pts);
      this.checkAllDone();
      return { ok: true, correct: true, points: pts, clue: this.clueIndex + 1, msg: 'Correct! +' + pts };
    }
    const key = m.normalized || text.toLowerCase();
    if (g.tried.has(key)) return { ok: false, msg: 'You already tried that.' };
    g.tried.add(key);
    if (m.method === 'ambiguous') {
      return { ok: true, correct: false, ambiguous: true, left: MAX_WRONG - g.wrong, msg: 'Be more specific. That did not count as a guess.' };
    }
    g.wrong++;
    this.wrongCounts.set(key, (this.wrongCounts.get(key) || 0) + 1);
    const left = MAX_WRONG - g.wrong;
    this.checkAllDone();
    return { ok: true, correct: false, left, msg: left > 0 ? 'Not it. ' + left + ' guess' + (left === 1 ? '' : 'es') + ' left.' : 'Not it. You are out of guesses.' };
  }

  endsInMs() { return Math.max(0, this.deadline - Date.now()); }

  rankings() {
    return [...this.runScore.entries()].map(([pid, score]) => {
      const p = this.room.players.get(pid);
      return { pid, name: p ? p.name : '?', score };
    }).sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1));
  }

  hostView() {
    const base = { caseNo: this.caseNo + 1, total: this.cases.length, points: POINTS };
    if (this.stage === 'play') {
      const c = this.counts();
      return { ...base, stage: 'play', clueIndex: this.clueIndex, clues: this.cur.clues.slice(0, this.clueIndex + 1), endsInMs: this.endsInMs(), lastClue: this.clueIndex === 3, solved: c.solved, guessing: c.guessing, playerCount: c.total };
    }
    if (this.stage === 'reveal') {
      const shown = this.solverNames.slice(0, 12);
      return { ...base, stage: 'reveal', diagnosis: this.cur.diagnosis, clues: this.cur.clues, teaching: this.cur.teaching || '', solvers: shown, moreSolvers: Math.max(0, this.solverNames.length - shown.length), commonWrong: this.commonWrong, playerCount: this.counts().total, endsInMs: this.endsInMs(), lastCase: this.caseNo + 1 >= this.cases.length };
    }
    return { ...base, stage: 'done', top: this.rankings().slice(0, 5).map((r) => ({ name: r.name, score: r.score })) };
  }

  playerView(pid) {
    const base = { caseNo: this.caseNo + 1, total: this.cases.length, points: POINTS };
    const status = this.statusOf(pid);
    const g = this.guessState(pid);
    if (this.stage === 'play') {
      const s = this.solved.get(pid);
      return { ...base, stage: 'play', clueIndex: this.clueIndex, clues: this.cur.clues.slice(0, this.clueIndex + 1), endsInMs: this.endsInMs(), status, guessesLeft: Math.max(0, MAX_WRONG - g.wrong), solvedPts: s ? s.pts : 0, solvedClue: s ? s.clue + 1 : 0, lastClue: this.clueIndex === 3 };
    }
    if (this.stage === 'reveal') {
      const s = this.solved.get(pid);
      return { ...base, stage: 'reveal', diagnosis: this.cur.diagnosis, clues: this.cur.clues, teaching: this.cur.teaching || '', status, solvedPts: s ? s.pts : 0, solvedClue: s ? s.clue + 1 : 0, endsInMs: this.endsInMs(), lastCase: this.caseNo + 1 >= this.cases.length };
    }
    const r = this.rankings();
    const idx = r.findIndex((x) => x.pid === pid);
    const top = r.slice(0, 5).map((x) => ({ name: x.name, score: x.score }));
    return { ...base, stage: 'done', top, rank: idx >= 0 ? idx + 1 : null, ranked: Math.max(r.length, this.active().length), myScore: this.runScore.get(pid) || 0 };
  }
}

ClueLadderActivity.meta = {
  type: 'clueladder',
  title: 'Clue Ladder',
  blurb: 'Name the diagnosis from four clues that get easier. Earlier guesses earn more.',
  minPlayers: 1,
  options: [],
};

module.exports = ClueLadderActivity;
