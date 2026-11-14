'use strict';
// Validate data/clue_cases.json. Usage: node data/drafts/v4/validate_clues.js [path]
const fs = require('fs');
const path = require('path');
const { PromptMatcher, normalize } = require('../../server/matcher');

const CATS = ['Diagnostic Dilemmas', 'Atypical Presentations of Common Diseases', 'Complex Pathophysiology', 'Unexpected Drug Interactions'];

function validate(data) {
  const errors = [];
  const warnings = [];
  if (!data || !Array.isArray(data.cases)) return { errors: ['cases array missing'], warnings };
  const ids = new Set();
  const diagKeys = new Map();
  data.cases.forEach((c, i) => {
    const at = `case ${c && c.id ? c.id : '#' + i}`;
    const err = (m) => errors.push(`${at}: ${m}`);
    if (!c || typeof c !== 'object') return err('not an object');
    if (!c.id || typeof c.id !== 'string') err('missing id');
    else if (ids.has(c.id)) err('duplicate id'); else ids.add(c.id);
    if (!CATS.includes(c.category)) err('bad category ' + c.category);
    if (!c.diagnosis || typeof c.diagnosis !== 'string') err('missing diagnosis');
    if (!c.teaching || typeof c.teaching !== 'string') err('missing teaching');
    if (typeof c.review_notes !== 'string') err('review_notes must be a string');
    if (!Array.isArray(c.clues) || c.clues.length !== 4) err('needs exactly 4 clues');
    else c.clues.forEach((cl, k) => {
      if (typeof cl !== 'string' || !cl.trim()) return err(`clue ${k + 1} empty`);
      const w = cl.trim().split(/\s+/).length;
      if (w < 8 || w > 25) err(`clue ${k + 1} has ${w} words (need 8-25)`);
    });
    if (Array.isArray(c.clues) && new Set(c.clues).size !== c.clues.length) err('duplicate clues');
    if (!Array.isArray(c.aliases) || c.aliases.length < 2 || c.aliases.length > 6) err('needs 2-6 aliases (spec says 3-6; short lists are warned)');
    else if (c.aliases.length < 3) warnings.push(`${at}: only ${c.aliases.length} aliases`);
    if (!Array.isArray(c.common_wrong) || c.common_wrong.length < 2 || c.common_wrong.length > 3) err('needs 2-3 common_wrong');
    if (c.diagnosis && Array.isArray(c.aliases)) {
      const dk = normalize(c.diagnosis);
      const seen = new Set([dk]);
      for (const a of c.aliases) {
        if (typeof a !== 'string' || !a.trim()) { err('empty alias'); continue; }
        const k = normalize(a);
        if (seen.has(k)) err(`alias "${a}" duplicates the diagnosis or another alias`);
        seen.add(k);
      }
      for (const w of c.common_wrong || []) {
        const k = normalize(w);
        if (seen.has(k)) err(`common_wrong "${w}" collides with the diagnosis or an alias`);
      }
      const m = new PromptMatcher({ answers: [{ name: c.diagnosis, aliases: c.aliases }] });
      if (m.collisions.length) err(m.collisions.join('; '));
      if (diagKeys.has(dk)) err('same diagnosis as ' + diagKeys.get(dk)); else diagKeys.set(dk, c.id);
    }
  });
  // cross-case alias collisions: an alias that is another case's diagnosis or alias
  const owner = new Map();
  data.cases.forEach((c) => {
    for (const n of [c.diagnosis, ...(c.aliases || [])]) {
      const k = normalize(n);
      if (owner.has(k) && owner.get(k) !== c.id) errors.push(`case ${c.id}: "${n}" is also used by ${owner.get(k)}`);
      else owner.set(k, c.id);
    }
  });
  const cats = {};
  data.cases.forEach((c) => { cats[c.category] = (cats[c.category] || 0) + 1; });
  return { errors, warnings, cats, count: data.cases.length };
}

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'clue_cases.json');
  const res = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log('cases:', res.count, JSON.stringify(res.cats));
  res.warnings.forEach((w) => console.log('WARN', w));
  res.errors.forEach((e) => console.log('ERROR', e));
  if (res.count < 40) { console.log('ERROR need at least 40 cases'); res.errors.push('count'); }
  console.log(res.errors.length ? `${res.errors.length} error(s)` : 'OK');
  process.exit(res.errors.length ? 1 : 0);
}
module.exports = { validate };
