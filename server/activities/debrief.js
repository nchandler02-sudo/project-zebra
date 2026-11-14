'use strict';
/**
 * Debrief Round: one reflective prompt about HOW we reasoned, answered anonymously (tag chips + short text),
 * shown on the projector as a word cloud, tag bars, moderated quotes and a teaching card.
 * Responses are anonymous: no player id or name is ever placed in any view alongside text.
 */
const fs = require('fs');
const path = require('path');

const PROMPT_MS = 90 * 1000;
const POINTS = 5;
const MAX_TEXT = 100;
const MAX_TAGS = 2;
const MAX_QUOTES = 6;
const MAX_WORDS = 40;

let CACHE = null;
function loadPrompts() {
  if (CACHE) return CACHE;
  let list = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'debrief_prompts.json'), 'utf8'));
    list = (Array.isArray(raw.prompts) ? raw.prompts : []).filter((p) => p && typeof p.id === 'string' && typeof p.prompt === 'string'
      && Array.isArray(p.tags) && p.tags.length >= 2 && p.tags.every((t) => typeof t === 'string' && t))
      .map((p) => ({ id: p.id, theme: String(p.theme || ''), prompt: p.prompt, tags: p.tags.slice(0, 8), teaching: String(p.teaching || '') }));
  } catch (e) { console.error('[debrief] could not load prompts:', e.message); }
  CACHE = list;
  return CACHE;
}

const STOP = new Set(('a about above after again all also am an and any are as at be because been before being below between both but by '
  + 'can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its '
  + 'just me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their '
  + 'them then there these they this those through to too under until up us very was we were what when where which while who whom why will '
  + 'with would you your yours yourself im ive id dont didnt wasnt isnt cant wont thing things really much many got get one').split(/\s+/));

const BAD = new Set(('fuck fucking fucker fucked shit shitty bullshit bitch bitches asshole assholes bastard dick dickhead cunt crap piss '
  + 'idiot idiots moron morons dumbass dumbasses jackass retard retarded retards slut whore twat wanker prick '
  + 'nigger niggers nigga faggot faggots fag fags tranny kike spic chink wetback gook dyke').split(/\s+/));

function cleanText(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT).trim();
}

function deleet(s) {
  return s.toLowerCase().replace(/[@]/g, 'a').replace(/\$/g, 's').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's');
}

function isProfane(text) {
  const toks = deleet(text).split(/[^a-z]+/).filter(Boolean);
  for (const t of toks) {
    if (BAD.has(t)) return true;
    if (t.endsWith('s') && BAD.has(t.slice(0, -1))) return true;
  }
  // spaced-out letters such as "f u c k"
  const squashed = deleet(text).replace(/[^a-z]/g, '');
  if (/(fuck|nigger|nigga|faggot)/.test(squashed)) return true;
  return false;
}

function words(text) {
  return text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
}

/** Build [{w, n}] top words from free-text answers. */
function wordCloud(texts) {
  const raw = new Map();
  for (const t of texts) for (const w of words(t)) {
    if (w.length < 2 || STOP.has(w) || BAD.has(w)) continue;
    raw.set(w, (raw.get(w) || 0) + 1);
  }
  const merged = new Map();
  for (const [w, n] of raw) {
    let key = w;
    if (w.length > 3 && w.endsWith('ies') && raw.has(w.slice(0, -3) + 'y')) key = w.slice(0, -3) + 'y';
    else if (w.length > 3 && w.endsWith('es') && raw.has(w.slice(0, -2))) key = w.slice(0, -2);
    else if (w.length > 2 && w.endsWith('s') && raw.has(w.slice(0, -1))) key = w.slice(0, -1);
    merged.set(key, (merged.get(key) || 0) + n);
  }
  return [...merged.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_WORDS).map(([w, n]) => ({ w, n }));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

class DebriefActivity {
  static meta = {
    type: 'debrief', title: 'Debrief Round', key: 'debrief', minPlayers: 1, options: [],
    blurb: 'One anonymous reflection prompt about how we reasoned, with a word cloud and a teaching point.',
  };

  constructor(room, opts) {
    this.room = room;
    this.prompts = loadPrompts();
    this.used = new Set();
    this.stage = 'prompt';
    this.finished = false;
    this.tagTotals = new Map(); // label -> count across all prompts
    this.promptsRun = 0;
    this.responseTotal = 0;
    this.current = null;
    this.startPrompt();
  }

  startPrompt() {
    if (!this.prompts.length) { this.current = { id: 'none', theme: '', prompt: 'No prompts are available.', tags: ['Other', 'Nothing'], teaching: '' }; }
    else {
      let pool = this.prompts.filter((p) => !this.used.has(p.id));
      if (!pool.length) { const last = this.current && this.current.id; this.used.clear(); pool = this.prompts.filter((p) => p.id !== last); if (!pool.length) pool = this.prompts; }
      this.current = pool[Math.floor(Math.random() * pool.length)];
      this.used.add(this.current.id);
    }
    this.stage = 'prompt';
    this.deadline = Date.now() + PROMPT_MS;
    this.responses = new Map(); // pid -> {tags:[idx], text}
    this.awarded = new Set();
    this.accumulated = false;
    this.cloud = null;
    this.hidden = new Set();
    this.quotesOn = true;
  }

  /** Leave the prompt stage: tally tags once and freeze the cloud data. */
  closePrompt() {
    if (this.stage !== 'prompt') return;
    if (!this.accumulated) {
      this.accumulated = true;
      this.promptsRun++;
      for (const r of this.responses.values()) {
        this.responseTotal++;
        for (const i of r.tags) { const lab = this.current.tags[i]; this.tagTotals.set(lab, (this.tagTotals.get(lab) || 0) + 1); }
      }
    }
    const texts = [];
    for (const r of this.responses.values()) if (r.text && !isProfane(r.text)) texts.push(r.text);
    const counts = this.current.tags.map(() => 0);
    for (const r of this.responses.values()) for (const i of r.tags) counts[i]++;
    const quotes = shuffle(texts.filter((t) => t.length >= 4)).slice(0, MAX_QUOTES);
    this.cloud = { words: wordCloud(texts), bars: this.current.tags.map((label, i) => ({ label, count: counts[i] })), quotes, n: this.responses.size };
    this.stage = 'cloud';
  }

  active() { return [...this.room.players.values()].filter((p) => p.connected !== false).length; }

  hostView() {
    const base = { stage: this.stage };
    if (this.stage === 'prompt') {
      return { ...base, prompt: this.current.prompt, theme: this.current.theme, responded: this.responses.size, total: this.active(), endsInMs: Math.max(0, this.deadline - Date.now()) };
    }
    if (this.stage === 'cloud') {
      const c = this.cloud;
      return {
        ...base, prompt: this.current.prompt, theme: this.current.theme, responded: c.n, total: this.active(),
        words: c.words, bars: c.bars, quotesOn: this.quotesOn,
        quotes: this.quotesOn ? c.quotes.map((text, i) => ({ i, text })).filter((q) => !this.hidden.has(q.i)) : [],
        teaching: this.current.teaching,
      };
    }
    return { ...base, summary: this.summary(), promptsRun: this.promptsRun, responses: this.responseTotal };
  }

  playerView(pid) {
    if (this.stage === 'prompt') {
      const mine = this.responses.get(pid);
      return {
        stage: 'prompt', prompt: this.current.prompt, tags: this.current.tags, maxTags: MAX_TAGS, maxText: MAX_TEXT,
        endsInMs: Math.max(0, this.deadline - Date.now()),
        mine: mine ? { tags: mine.tags.slice(), text: mine.text } : null,
      };
    }
    if (this.stage === 'cloud') {
      return { stage: 'cloud', prompt: this.current.prompt, teaching: this.current.teaching, earned: this.awarded.has(pid) ? POINTS : 0 };
    }
    return { stage: 'done', summary: this.summary() };
  }

  summary() {
    if (!this.tagTotals.size) return 'No reflections were recorded this time.';
    const top = [...this.tagTotals.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3);
    return 'Most common reflections: ' + top.map(([l, n]) => `${l} (${n})`).join(', ') + '.';
  }

  handle(player, d) {
    if (!d || typeof d !== 'object' || d.t !== 'respond') return { ok: false, error: 'bad request' };
    if (this.stage !== 'prompt') return { ok: false, error: 'This prompt is closed.' };
    if (Date.now() > this.deadline) return { ok: false, error: 'Time is up.' };
    const n = this.current.tags.length;
    const seen = new Set();
    const tags = [];
    if (d.tags !== undefined) {
      if (!Array.isArray(d.tags) || d.tags.length > MAX_TAGS) return { ok: false, error: 'Pick up to 2 tags.' };
      for (const i of d.tags) {
        if (!Number.isInteger(i) || i < 0 || i >= n) return { ok: false, error: 'Unknown tag.' };
        if (!seen.has(i)) { seen.add(i); tags.push(i); }
      }
    }
    if (d.text !== undefined && typeof d.text !== 'string') return { ok: false, error: 'Bad text.' };
    const text = cleanText(d.text || '');
    if (!tags.length && !text) return { ok: false, error: 'Pick a tag or write a few words.' };
    this.responses.set(player.id, { tags, text });
    let earned = 0;
    if (!this.awarded.has(player.id)) { this.awarded.add(player.id); this.room.addScore(player.id, POINTS); earned = POINTS; }
    return { ok: true, tags, text, earned };
  }

  hostCommand(cmd, d) {
    if (this.stage === 'done') return;
    if (cmd === 'next') { this.closePrompt(); this.startPrompt(); }
    else if (cmd === 'close') { if (this.stage === 'prompt') this.closePrompt(); }
    else if (cmd === 'done') { this.closePrompt(); this.stage = 'done'; this.finished = true; }
    else if (cmd === 'hide') {
      if (this.stage === 'cloud' && d && Number.isInteger(d.i) && d.i >= 0 && d.i < this.cloud.quotes.length) this.hidden.add(d.i);
    } else if (cmd === 'quotes') {
      if (this.stage === 'cloud') this.quotesOn = d && typeof d.on === 'boolean' ? d.on : !this.quotesOn;
    }
  }

  tick(now) {
    if (this.stage === 'prompt' && now >= this.deadline) { this.closePrompt(); return true; }
    return false;
  }
}

module.exports = DebriefActivity;
module.exports._internals = { cleanText, isProfane, wordCloud };
