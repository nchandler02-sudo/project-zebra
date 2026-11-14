'use strict';
// Validates data/connections_puzzles.json. Usage: node data/drafts/v4/validate_connections.js [file]
const fs = require('fs');
const path = require('path');

function validate(data) {
  const errs = [];
  if (!data || !Array.isArray(data.puzzles)) return ['puzzles array missing'];
  if (data.puzzles.length < 24) errs.push('fewer than 24 puzzles: ' + data.puzzles.length);
  const ids = new Set();
  data.puzzles.forEach((p, i) => {
    const w = `puzzle ${(p && p.id) || i}`;
    if (!p || typeof p.id !== 'string' || ids.has(p.id)) errs.push(`${w}: missing or duplicate id`);
    ids.add(p && p.id);
    if (!p || typeof p.title !== 'string' || !p.title) errs.push(`${w}: no title`);
    if (!p || typeof p.review_notes !== 'string' || !p.review_notes) errs.push(`${w}: no review_notes`);
    if (!p || !Array.isArray(p.groups) || p.groups.length !== 4) { errs.push(`${w}: need 4 groups`); return; }
    const levels = new Set(); const seen = new Set();
    for (const g of p.groups) {
      if (typeof g.category !== 'string' || !g.category) errs.push(`${w}: group without category`);
      if (typeof g.explain !== 'string' || !g.explain) errs.push(`${w}: group without explain`);
      if (![1, 2, 3, 4].includes(g.level)) errs.push(`${w}: bad level ${g.level}`);
      levels.add(g.level);
      if (!Array.isArray(g.items) || g.items.length !== 4) { errs.push(`${w}: group needs 4 items`); continue; }
      for (const it of g.items) {
        if (typeof it !== 'string' || !it.trim()) { errs.push(`${w}: bad item`); continue; }
        if (it.trim().split(/\s+/).length > 5) errs.push(`${w}: item over 5 words: ${it}`);
        const k = it.trim().toLowerCase();
        if (seen.has(k)) errs.push(`${w}: duplicate item ${it}`);
        seen.add(k);
      }
    }
    if (levels.size !== 4) errs.push(`${w}: levels 1-4 must each be used once`);
    if (seen.size !== 16) errs.push(`${w}: need 16 unique items, got ${seen.size}`);
  });
  return errs;
}

module.exports = { validate };

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'connections_puzzles.json');
  const errs = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log('OK: connections puzzles valid');
}
