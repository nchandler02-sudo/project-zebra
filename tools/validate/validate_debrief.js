'use strict';
// Validates data/debrief_prompts.json. Usage: node data/drafts/v4/validate_debrief.js [file]
const fs = require('fs');
const path = require('path');

function validate(data) {
  const errs = [];
  if (!data || typeof data !== 'object') return ['root is not an object'];
  if (data.version !== 1) errs.push('version must be 1');
  if (typeof data.review_status !== 'string') errs.push('review_status missing');
  if (typeof data.generator !== 'string') errs.push('generator missing');
  const ps = data.prompts;
  if (!Array.isArray(ps)) return errs.concat('prompts must be an array');
  if (ps.length < 30) errs.push(`need at least 30 prompts, have ${ps.length}`);
  const ids = new Set();
  ps.forEach((p, i) => {
    const w = `prompt[${i}]`;
    if (!p || typeof p !== 'object') { errs.push(`${w} not an object`); return; }
    if (typeof p.id !== 'string' || !p.id) errs.push(`${w} id missing`);
    else if (ids.has(p.id)) errs.push(`${w} duplicate id ${p.id}`); else ids.add(p.id);
    if (typeof p.theme !== 'string' || !p.theme) errs.push(`${w} theme missing`);
    if (typeof p.prompt !== 'string' || p.prompt.length < 15 || p.prompt.length > 220) errs.push(`${w} prompt length 15-220 required`);
    if (!Array.isArray(p.tags) || p.tags.length < 4 || p.tags.length > 6) errs.push(`${w} needs 4-6 tags`);
    else {
      const seen = new Set();
      p.tags.forEach((t) => {
        if (typeof t !== 'string' || !t.trim() || t.length > 32) errs.push(`${w} bad tag ${JSON.stringify(t)} (1-32 chars)`);
        else if (seen.has(t.toLowerCase())) errs.push(`${w} duplicate tag ${t}`); else seen.add(t.toLowerCase());
      });
    }
    if (typeof p.teaching !== 'string' || p.teaching.length < 60 || p.teaching.length > 450) errs.push(`${w} teaching length 60-450 required`);
    else {
      const sentences = p.teaching.split(/(?<=[.!?])\s+/).filter(Boolean).length;
      if (sentences < 2 || sentences > 3) errs.push(`${w} teaching must be 2-3 sentences (found ${sentences})`);
    }
  });
  return errs;
}

module.exports = { validate };

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'debrief_prompts.json');
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('cannot read/parse:', e.message); process.exit(1); }
  const errs = validate(data);
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  const themes = new Set(data.prompts.map((p) => p.theme));
  console.log(`OK: ${data.prompts.length} prompts, ${themes.size} themes`);
}
