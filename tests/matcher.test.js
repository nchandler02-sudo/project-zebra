'use strict';
// Matcher test suite: node --test tests/matcher.test.js   (also: npm test)
// Runs a batch of intentionally misspelled terms against the real question database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PromptMatcher, normalize, distance, similarity, coreOf, confusable, FUZZY_THRESHOLD } = require('../server/matcher');

const DB_PATH = process.env.ZEBRA_DB || path.join(__dirname, '..', 'data', 'clinical_prompts_db.json');
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const matchers = db.prompts.map((p) => ({ p, m: new PromptMatcher(p) }));

// deterministic RNG so failures reproduce
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const NEIGHBOURS = { a: 'sq', e: 'wr', i: 'uo', o: 'ip', u: 'yi', n: 'bm', m: 'n', s: 'ad', t: 'ry', r: 'et', l: 'k', c: 'xv', d: 'sf', p: 'o', h: 'g' };

function mutate(str, rand, edits) {
  let s = str;
  for (let e = 0; e < edits; e++) {
    const letters = [...s].map((c, i) => (/[a-z]/i.test(c) ? i : -1)).filter((i) => i > 0 && i < s.length - 1);
    if (!letters.length) break;
    const i = letters[Math.floor(rand() * letters.length)];
    const kind = Math.floor(rand() * 4);
    if (kind === 0) s = s.slice(0, i) + s.slice(i + 1); // deletion
    else if (kind === 1 && i + 1 < s.length) s = s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2); // transposition
    else if (kind === 2) { const n = NEIGHBOURS[s[i].toLowerCase()] || 'x'; s = s.slice(0, i) + n[Math.floor(rand() * n.length)] + s.slice(i + 1); } // substitution
    else s = s.slice(0, i) + s[i] + s.slice(i); // doubled letter
  }
  return s;
}

test('normalizer', () => {
  assert.equal(normalize("Addison's Disease (primary)"), 'addison disease');
  assert.equal(normalize('Behçet disease'), 'behcet disease');
  assert.equal(normalize('  TMP-SMX  '), 'tmp smx');
  assert.equal(normalize('The Wegener granulomatosis'), 'wegener granulomatosis');
  assert.equal(normalize('anti-Hu Ab'), 'anti hu antibody');
  assert.equal(normalize('R&D w/o fever'), 'r and d without fever');
  assert.equal(normalize(''), '');
  assert.equal(normalize(null), '');
});

test('distance handles typos and transpositions', () => {
  assert.equal(distance('kitten', 'sitting'), 3);
  assert.equal(distance('amiodarone', 'amiodaorne'), 1);
  assert.equal(distance('', 'abc'), 3);
  assert.ok(similarity('metronidazole', 'metronidazol') >= FUZZY_THRESHOLD);
});

test('database loads and has no alias collisions', () => {
  assert.ok(db.prompts.length >= 4, 'expected at least 4 prompts');
  for (const { p, m } of matchers) {
    assert.deepEqual(m.collisions, [], `${p.id} has alias collisions`);
    assert.ok(p.answers.length >= 25, `${p.id} has too few answers`);
  }
});

test('every canonical name and alias resolves to its own answer', () => {
  let n = 0;
  for (const { p, m } of matchers) {
    p.answers.forEach((a, idx) => {
      for (const raw of [a.name, ...(a.aliases || [])]) {
        const r = m.match(raw);
        assert.ok(r.matched && r.index === idx, `${p.id}: "${raw}" -> ${r.matched ? p.answers[r.index].name : r.method} (wanted ${a.name})`);
        n++;
      }
    });
  }
  console.log(`  ${n} names/aliases resolved exactly`);
});

test('case, punctuation and spacing variants of every name still match', () => {
  for (const { p, m } of matchers) {
    p.answers.forEach((a, idx) => {
      const variants = [a.name.toUpperCase(), a.name.toLowerCase(), `  ${a.name}  `, a.name.replace(/-/g, ' '), a.name.replace(/\s+/g, '  '), `${a.name}.`];
      for (const v of variants) {
        const r = m.match(v);
        assert.ok(r.matched && r.index === idx, `${p.id}: variant "${v}" -> ${r.matched ? p.answers[r.index].name : r.method} (wanted ${a.name})`);
      }
    });
  }
});

test('zero false negatives on generated misspellings', () => {
  const rand = rng(20240611);
  let tried = 0; let skippedBelow = 0; let skippedAmbiguous = 0; const misses = [];
  for (const { p, m } of matchers) {
    p.answers.forEach((a, idx) => {
      const sources = [a.name, ...(a.aliases || []).filter((x) => normalize(x).length >= 8)];
      for (const src of sources) {
        const key = normalize(src);
        if (key.length < 6) continue; // one typo in <6 chars drops similarity under the threshold by design
        if (/(^| )[a-z]( |$)/.test(key)) continue; // single-letter tokens (MAO-B, penicillin G) only fuzz to adjacent keys by design
        for (let rep = 0; rep < 12; rep++) {
          const edits = key.length >= 12 && rep % 3 === 0 ? 2 : 1;
          const typo = mutate(src, rand, edits);
          const tk = normalize(typo);
          if (tk === key || !tk) continue;
          if (similarity(tk, key) < FUZZY_THRESHOLD) { skippedBelow++; continue; }
          if (confusable(tk, key)) { skippedAmbiguous++; continue; } // e.g. "nephritic" for "nephrotic": different diagnoses, refused on purpose
          const r = m.match(typo);
          if (r.matched && r.index === idx) { tried++; continue; }
          // inherently ambiguous: the typo is as close (or closer) to a different answer's key
          let rival = false;
          p.answers.forEach((b, j) => {
            if (j === idx || rival) return;
            for (const rk of [b.name, ...(b.aliases || [])]) {
              // the matcher also indexes each key with a trailing generic word removed ("cushing syndrome" -> "cushing")
              const nk = normalize(rk);
              const s = Math.max(similarity(tk, nk), similarity(tk, coreOf(nk)));
              if (s >= FUZZY_THRESHOLD && s >= similarity(tk, key) - 0.02) { rival = true; return; }
            }
          });
          if (rival) { skippedAmbiguous++; continue; }
          tried++;
          misses.push(`${p.id}: "${typo}" (from "${src}") -> ${r.matched ? p.answers[r.index].name : r.method}`);
        }
      }
    });
  }
  console.log(`  ${tried} misspellings checked; ${skippedBelow} fell below the ${FUZZY_THRESHOLD} threshold by construction; ${skippedAmbiguous} equidistant from another answer`);
  assert.ok(tried > 300, `only ${tried} typos generated`);
  assert.deepEqual(misses, [], `false negatives:\n${misses.join('\n')}`);
});

test('unrelated or empty input never matches', () => {
  const junk = ['', ' ', 'a', 'x', 'banana', 'asdfghjkl', 'i dont know', 'the', '12345', 'pizza', 'lorem ipsum dolor'];
  for (const { p, m } of matchers) for (const j of junk) assert.equal(m.match(j).matched, false, `${p.id}: "${j}" should not match`);
});

test('digit and single-letter differences are not fuzzed away', () => {
  const m = new PromptMatcher({ answers: [
    { name: 'Anti-Ma1 antibody', score: 90 }, { name: 'Anti-Ma2 antibody', score: 95 },
    { name: 'Anti-GABA-A receptor encephalitis', score: 99 }, { name: 'Anti-GABA-B receptor encephalitis', score: 94 },
  ] });
  assert.equal(m.match('anti ma2 antibody').index, 1);
  assert.equal(m.match('anti ma3 antibody').matched, false);
  assert.equal(m.match('anti gaba b receptor encephalitis').index, 3);
  assert.equal(m.match('anti gaba c receptor encephalitis').matched, false);
});

test('near-ties between different answers are refused rather than guessed', () => {
  const m = new PromptMatcher({ answers: [{ name: 'Sulfasalazine', score: 40 }, { name: 'Sulfadiazine', score: 50 }] });
  assert.equal(m.match('sulfasalazine').index, 0);
  assert.equal(m.match('sulfadiazine').index, 1);
  const r = m.match('sulfasadiazine');
  assert.equal(r.matched, false);
  assert.equal(r.method, 'ambiguous');
});

test('hand-written real-world misspellings resolve to the right answer', () => {
  const cases = [
    ['fuo-causes', 'tuberculosus', 'Tuberculosis'],
    ['fuo-causes', 'hemophagocytic lymphohistiocytosus', 'Hemophagocytic lymphohistiocytosis'],
    ['fuo-causes', 'epstein barr virus', 'Epstein-Barr virus infection'],
    ['fuo-causes', 'kikuchi fujimoto', 'Kikuchi-Fujimoto disease'],
    ['fuo-causes', 'intravascular large b cell lymphoma', 'Intravascular large B-cell lymphoma'],
    ['fuo-causes', 'angioimmunoblastic t cell lymphoma', 'Angioimmunoblastic T-cell lymphoma'],
    ['warfarin-potentiators', 'cimetidne', 'Cimetidine'],
    ['warfarin-potentiators', 'erythromicin', 'Erythromycin'],
    ['warfarin-potentiators', 'simvastatn', 'Simvastatin'],
    ['warfarin-potentiators', 'gingko biloba', 'Ginkgo biloba'],
    ['warfarin-potentiators', 'chloral hydrat', 'Chloral hydrate'],
    ['warfarin-potentiators', 'ketoconazol', 'Ketoconazole'],
    ['high-anion-gap-acidosis-causes', 'methanol poisonin', 'Methanol poisoning'],
    ['high-anion-gap-acidosis-causes', 'cyanide poisening', 'Cyanide poisoning'],
    ['high-anion-gap-acidosis-causes', 'propofol infusion syndrom', 'Propofol infusion syndrome'],
    ['high-anion-gap-acidosis-causes', 'methylmalonic acidemea', 'Methylmalonic acidemia'],
    ['paraneoplastic-syndromes-antibodies', 'anti mglur 1 antibodies', 'Anti-mGluR1 antibodies'],
    ['paraneoplastic-syndromes-antibodies', 'paraneoplastic pemphigis', 'Paraneoplastic pemphigus'],
    ['paraneoplastic-syndromes-antibodies', 'anti-tr antibodys', 'Anti-Tr antibodies'],
    ['paraneoplastic-syndromes-antibodies', 'erythema gyratum repens', 'Erythema gyratum repens'],
    ['paraneoplastic-syndromes-antibodies', 'leser trelat', 'Leser-Trelat sign'],
  ];
  for (const [pid, typed, want] of cases) {
    const entry = matchers.find((x) => x.p.id === pid);
    assert.ok(entry, `prompt ${pid} missing`);
    const r = entry.m.match(typed);
    assert.ok(r.matched && entry.p.answers[r.index].name === want, `"${typed}" -> ${r.matched ? entry.p.answers[r.index].name : r.method} (wanted ${want})`);
  }
});
