'use strict';
// Validates data/chopped_cases.json. Usage: node data/drafts/v4/validate_chopped.js
const fs = require('fs');
const path = require('path');
const { PromptMatcher } = require('../../server/matcher');

const KINDS = ['leading', 'must-not-miss', 'reasonable', 'rare-but-valid'];
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

function validate(file) {
  const errs = [];
  const warn = [];
  let data;
  try { data = JSON.parse(fs.readFileSync(file || path.join(__dirname, '..', '..', 'data', 'chopped_cases.json'), 'utf8')); } catch (e) { return { errs: ['cannot read/parse: ' + e.message], warn, count: 0 }; }
  if (data.version !== 1) errs.push('version must be 1');
  if (!Array.isArray(data.cases) || data.cases.length < 12) errs.push('need at least 12 cases');
  const ids = new Set();
  for (const c of data.cases || []) {
    const t = `[${c.id}]`;
    if (!c.id || ids.has(c.id)) errs.push(`${t} missing or duplicate id`);
    ids.add(c.id);
    for (const k of ['title', 'diagnosis', 'teaching', 'review_notes']) if (typeof c[k] !== 'string' || !c[k].trim()) errs.push(`${t} missing ${k}`);
    if (!Array.isArray(c.aliases)) errs.push(`${t} aliases must be an array`);
    if (c.title && c.diagnosis && c.title.toLowerCase().includes(c.diagnosis.toLowerCase())) errs.push(`${t} title gives away the diagnosis`);
    if (!Array.isArray(c.stages) || c.stages.length !== 4) { errs.push(`${t} needs exactly 4 stages`); continue; }
    c.stages.forEach((s, i) => {
      const w = words(s.text);
      if (!s.label || w < 25 || w > 60) errs.push(`${t} stage ${i} label/word count (${w}) out of 25-60`);
    });
    const dx = c.differential;
    if (!Array.isArray(dx) || dx.length < 8 || dx.length > 14) { errs.push(`${t} differential needs 8-14 entries`); continue; }
    dx.forEach((d, i) => {
      if (!d.name || !Array.isArray(d.aliases)) errs.push(`${t} dx ${i} name/aliases`);
      if (!Number.isInteger(d.points) || d.points < 1 || d.points > 5) errs.push(`${t} dx ${d.name} points`);
      if (!KINDS.includes(d.kind)) errs.push(`${t} dx ${d.name} kind`);
      if (!Number.isInteger(d.from_stage) || d.from_stage < 0 || d.from_stage > 3) errs.push(`${t} dx ${d.name} from_stage`);
    });
    if (dx.filter((d) => d.kind === 'must-not-miss').length < 1) errs.push(`${t} needs a must-not-miss item`);
    if (dx.filter((d) => d.kind === 'must-not-miss').some((d) => d.points !== 4)) errs.push(`${t} must-not-miss should be 4 points`);
    const m = new PromptMatcher({ answers: dx.map((d) => ({ name: d.name, aliases: d.aliases })) });
    for (const col of m.collisions) errs.push(`${t} alias collision: ${col}`);
    dx.forEach((d, i) => {
      for (const s of [d.name, ...d.aliases]) { const r = m.match(s); if (!r.matched || r.index !== i) errs.push(`${t} "${s}" does not match its own item (${r.method})`); }
    });
    const fi = dx.findIndex((d) => d.points === 5);
    if (fi < 0 || dx.filter((d) => d.points === 5).length !== 1) errs.push(`${t} exactly one 5-point final diagnosis required`);
    for (const s of [c.diagnosis, ...(c.aliases || [])]) { const r = m.match(s); if (!r.matched || r.index !== fi) errs.push(`${t} case diagnosis/alias "${s}" does not match the final diagnosis item`); }
    for (let i = 0; i < 3; i++) if (c.stages[i].text.toLowerCase().includes(c.diagnosis.toLowerCase())) warn.push(`${t} stage ${i} contains the diagnosis text`);
  }
  return { errs, warn, count: (data.cases || []).length };
}

module.exports = { validate };
if (require.main === module) {
  const r = validate(process.argv[2]);
  r.warn.forEach((w) => console.log('WARN', w));
  r.errs.forEach((e) => console.log('ERROR', e));
  console.log(`${r.count} cases, ${r.errs.length} errors, ${r.warn.length} warnings`);
  process.exit(r.errs.length ? 1 : 0);
}
