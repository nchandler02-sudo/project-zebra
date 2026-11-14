'use strict';
/**
 * Connections: Differentials. A board of 16 clinical items sorts into 4 hidden groups of 4.
 * Every player solves their own board on the phone; the projector shows only progress until the reveal.
 * See server/activities/README.md for the plug-in contract.
 */
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', '..', 'data', 'connections_puzzles.json');
const RUN_LENGTH = 3;
const PLAY_MS = 150000;
const REVEAL_MS = 20000;
const MAX_MISTAKES = 4;
const GROUP_POINTS = { 1: 10, 2: 15, 3: 20, 4: 30 };
const COMPLETION_BONUS = 20;
const FIRST_FINISH_BONUS = 10;
const FIRST_FINISHERS = 3;

let cache = null; // parsed, sanity-filtered puzzles
function loadPuzzles() {
  if (cache) return cache;
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const out = [];
  for (const p of (raw && raw.puzzles) || []) {
    if (!p || typeof p.id !== 'string' || !Array.isArray(p.groups) || p.groups.length !== 4) continue;
    const ok = p.groups.every((g) => g && Array.isArray(g.items) && g.items.length === 4 && g.items.every((s) => typeof s === 'string') && [1, 2, 3, 4].includes(g.level));
    const items = new Set(p.groups.flatMap((g) => g.items));
    if (ok && items.size === 16) out.push(p);
  }
  if (out.length < RUN_LENGTH) throw new Error('not enough valid connections puzzles');
  cache = out;
  return cache;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Connections {
  static meta = {
    type: 'connections',
    title: 'Connections: Differentials',
    blurb: 'Sort 16 clinical items into 4 hidden groups. Beware the decoys. Three boards per run.',
    minPlayers: 1,
    options: [],
  };

  constructor(room, opts) {
    const all = loadPuzzles();
    let used = room.connectionsUsed;
    if (!(used instanceof Set)) used = room.connectionsUsed = new Set();
    let pool = all.filter((p) => !used.has(p.id));
    if (pool.length < RUN_LENGTH) { used.clear(); pool = all.slice(); }
    this.room = room;
    this.puzzles = shuffle(pool).slice(0, RUN_LENGTH);
    for (const p of this.puzzles) used.add(p.id);
    this.run = new Map(); // pid -> points earned in this run
    this.pi = -1;
    this.stage = 'play';
    this.finished = false;
    this.startPuzzle(0);
  }

  // ---------- puzzle lifecycle ----------
  startPuzzle(i) {
    this.pi = i;
    const p = this.puzzles[i];
    const tiles = [];
    p.groups.forEach((g, gi) => g.items.forEach((text) => tiles.push({ text, g: gi })));
    this.tiles = shuffle(tiles);
    this.states = new Map();
    this.wrong = new Array(16).fill(0);
    this.solvedBy = [0, 0, 0, 0];
    this.finishCount = 0;
    this.stage = 'play';
    this.deadline = Date.now() + PLAY_MS;
    this.nextAt = 0;
    this.decoy = null;
  }

  stateFor(pid) {
    let s = this.states.get(pid);
    if (!s) {
      s = { solved: [], mistakes: 0, over: null, pts: 0, guessed: new Set(), finishedAt: 0 };
      this.states.set(pid, s);
      if (!this.run.has(pid)) this.run.set(pid, 0);
    }
    return s;
  }

  activeIds() {
    return [...this.room.players.values()].filter((p) => p.connected !== false).map((p) => p.id);
  }

  allDone() {
    const ids = this.activeIds();
    return ids.length > 0 && ids.every((id) => this.stateFor(id).over);
  }

  award(pid, pts) {
    if (!pts) return;
    this.room.addScore(pid, pts);
    this.run.set(pid, (this.run.get(pid) || 0) + pts);
    this.stateFor(pid).pts += pts;
  }

  toReveal() {
    if (this.stage !== 'play') return;
    this.stage = 'reveal';
    this.nextAt = Date.now() + REVEAL_MS;
    let best = -1;
    this.wrong.forEach((n, i) => { if (n > 0 && (best < 0 || n > this.wrong[best])) best = i; });
    this.decoy = best < 0 ? null : { tile: best, count: this.wrong[best] };
  }

  advance() {
    if (this.stage === 'play') return this.toReveal();
    if (this.stage === 'reveal') {
      if (this.pi + 1 < this.puzzles.length) this.startPuzzle(this.pi + 1);
      else { this.stage = 'done'; this.finished = true; this.nextAt = 0; }
    }
  }

  // ---------- plug-in contract ----------
  tick(now) {
    if (this.stage === 'play') {
      if (now >= this.deadline || this.allDone()) { this.toReveal(); return true; }
    } else if (this.stage === 'reveal' && now >= this.nextAt) {
      this.advance();
      return true;
    }
    return false;
  }

  hostCommand(cmd) {
    if (cmd === 'next') this.advance();
  }

  handle(player, d) {
    if (this.stage !== 'play') return { ok: false, error: 'Not accepting answers right now.' };
    if (!d || typeof d !== 'object' || d.a !== 'submit') return { ok: false, error: 'Bad request.' };
    if (Date.now() >= this.deadline) return { ok: false, error: 'Time is up.' };
    const st = this.stateFor(player.id);
    if (st.over) return { ok: false, error: 'Your board is finished.' };
    const t = d.tiles;
    if (!Array.isArray(t) || t.length !== 4) return { ok: false, error: 'Pick exactly 4 tiles.' };
    for (const x of t) if (!Number.isInteger(x) || x < 0 || x > 15) return { ok: false, error: 'Bad tile.' };
    if (new Set(t).size !== 4) return { ok: false, error: 'Pick 4 different tiles.' };
    const solvedTiles = new Set();
    for (const g of st.solved) this.tiles.forEach((tile, i) => { if (tile.g === g) solvedTiles.add(i); });
    if (t.some((x) => solvedTiles.has(x))) return { ok: false, error: 'Those tiles are already solved.' };
    const key = [...t].sort((a, b) => a - b).join(',');
    if (st.guessed.has(key)) return { ok: false, error: 'You already tried that combination.' };
    st.guessed.add(key);

    const counts = [0, 0, 0, 0];
    for (const x of t) counts[this.tiles[x].g]++;
    const g = counts.indexOf(4);
    if (g >= 0) return this.solveGroup(player, st, g);

    st.mistakes++;
    for (const x of t) this.wrong[x]++;
    const oneAway = counts.some((c) => c === 3);
    if (st.mistakes >= MAX_MISTAKES) st.over = 'failed';
    return { ok: true, result: oneAway ? 'oneaway' : 'wrong', mistakes: st.mistakes, over: st.over === 'failed' };
  }

  solveGroup(player, st, g) {
    const grp = this.puzzles[this.pi].groups[g];
    st.solved.push(g);
    this.solvedBy[g]++;
    let pts = GROUP_POINTS[grp.level];
    let bonus = 0;
    if (st.solved.length === 4) {
      st.over = 'solved';
      this.finishCount++;
      st.finishedAt = this.finishCount;
      if (st.mistakes === 0) bonus += COMPLETION_BONUS;
      if (st.finishedAt <= FIRST_FINISHERS) bonus += FIRST_FINISH_BONUS;
    }
    this.award(player.id, pts + bonus);
    return { ok: true, result: 'correct', level: grp.level, category: grp.category, pts: pts + bonus, over: st.over === 'solved' };
  }

  // ---------- views ----------
  groupsInLevelOrder() {
    return this.puzzles[this.pi].groups.map((g, gi) => ({ g, gi })).sort((a, b) => a.g.level - b.g.level);
  }

  ranking() {
    const rows = [...this.run.entries()].map(([pid, pts]) => {
      const p = this.room.players.get(pid);
      return { pid, name: p ? p.name : '?', pts };
    });
    rows.sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
    return rows;
  }

  hostView() {
    const base = { stage: this.stage, pi: this.pi, total: this.puzzles.length };
    if (this.stage === 'done') {
      const rows = this.ranking();
      return { ...base, top: rows.slice(0, 5).map((r) => ({ name: r.name, pts: r.pts })), players: rows.length };
    }
    const ids = this.activeIds();
    let finished = 0;
    for (const id of ids) if (this.stateFor(id).over) finished++;
    if (this.stage === 'play') {
      return {
        ...base,
        endsInMs: Math.max(0, this.deadline - Date.now()),
        players: ids.length,
        finished,
        rows: this.groupsInLevelOrder().map(({ g, gi }) => ({ level: g.level, solved: this.solvedBy[gi] })),
      };
    }
    // reveal
    let participants = 0; let groupsSolved = 0;
    for (const s of this.states.values()) { participants++; groupsSolved += s.solved.length; }
    let decoy = null;
    if (this.decoy) {
      const tile = this.tiles[this.decoy.tile];
      const grp = this.puzzles[this.pi].groups[tile.g];
      decoy = { text: tile.text, count: this.decoy.count, category: grp.category, level: grp.level };
    }
    return {
      ...base,
      endsInMs: Math.max(0, this.nextAt - Date.now()),
      title: this.puzzles[this.pi].title,
      players: ids.length,
      finished,
      rows: this.groupsInLevelOrder().map(({ g, gi }) => ({ level: g.level, category: g.category, items: g.items.slice(), explain: g.explain, solved: this.solvedBy[gi] })),
      decoy,
      solveRate: participants ? Math.round((groupsSolved / (participants * 4)) * 100) : 0,
      last: this.pi + 1 >= this.puzzles.length,
    };
  }

  playerView(pid) {
    const base = { stage: this.stage, pi: this.pi, total: this.puzzles.length };
    if (this.stage === 'done') {
      const rows = this.ranking();
      const idx = rows.findIndex((r) => r.pid === pid);
      return {
        ...base,
        top: rows.slice(0, 5).map((r) => ({ name: r.name, pts: r.pts })),
        rank: idx < 0 ? 0 : idx + 1,
        players: rows.length,
        runPts: this.run.get(pid) || 0,
      };
    }
    const st = this.stateFor(pid);
    const puzzle = this.puzzles[this.pi];
    const solved = st.solved.map((gi) => ({
      level: puzzle.groups[gi].level,
      category: puzzle.groups[gi].category,
      items: puzzle.groups[gi].items.slice(),
      tiles: this.tiles.map((t, i) => (t.g === gi ? i : -1)).filter((i) => i >= 0),
    }));
    const v = {
      ...base,
      tiles: this.tiles.map((t) => t.text),
      solved,
      mistakes: st.mistakes,
      maxMistakes: MAX_MISTAKES,
      status: st.over || 'playing',
      pts: st.pts,
      runPts: this.run.get(pid) || 0,
    };
    if (this.stage === 'play') {
      v.endsInMs = Math.max(0, this.deadline - Date.now());
    } else {
      // reveal: the answers are no longer secret
      v.endsInMs = Math.max(0, this.nextAt - Date.now());
      v.last = this.pi + 1 >= this.puzzles.length;
      v.title = puzzle.title;
      v.groups = this.groupsInLevelOrder().map(({ g }) => ({ level: g.level, category: g.category, items: g.items.slice(), explain: g.explain }));
      const rows = this.ranking();
      v.rank = rows.findIndex((r) => r.pid === pid) + 1;
      v.players = rows.length;
    }
    return v;
  }
}

module.exports = Connections;
