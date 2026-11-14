'use strict';
/**
 * Build the standalone single-player page (no server needed to play).
 *   node tools/build_solo.js
 * Writes two copies of tools/solo_template.html with the question bank and the real matcher embedded:
 *   data/solo.html    for the claude.ai artifact (fragment: the artifact host supplies the document shell;
 *                     manifest/icon links removed because the artifact has no such files)
 *   public/solo.html  for the game server at /solo (full document, system fonts because the server's CSP blocks Google Fonts)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'clinical_prompts_db.json'), 'utf8'));
const matcherSrc = fs
  .readFileSync(path.join(ROOT, 'server', 'matcher.js'), 'utf8')
  .replace(/^'use strict';\s*/, '')
  .replace(/module\.exports\s*=\s*\{[^}]*\};?\s*$/m, '');

const slim = {
  prompts: db.prompts.map((p) => ({
    id: p.id,
    category: p.category,
    difficulty: p.difficulty,
    level: p.level || 'hard',
    prompt: p.prompt,
    answers: p.answers.map((a) => ({ name: a.name, score: a.score, aliases: a.aliases || [], pearl: a.pearl || '' })),
  })),
};
const json = JSON.stringify(slim).replace(/</g, '\\u003c').split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');

const template = fs.readFileSync(path.join(__dirname, 'solo_template.html'), 'utf8');
const full = template.replace('/*MATCHER*/', () => matcherSrc).replace('/*DATA*/', () => json);
const lines = full.split('\n');

// 1) claude.ai artifact copy
const artifact = lines.filter((l) => !/^<link rel="(manifest|apple-touch-icon)"/.test(l)).join('\n');
const outArtifact = path.join(ROOT, 'data', 'solo.html');
fs.writeFileSync(outArtifact, artifact);

// 2) server copy: real document, no Google Fonts links
const marker = '<div class="wrap" id="app"></div>';
const cut = lines.findIndex((l) => l.startsWith(marker));
if (cut < 0) throw new Error('template marker not found');
const head = lines.slice(0, cut).filter((l) => !/^<link rel="(preconnect|stylesheet)" href="https:\/\/fonts\./.test(l) && !/^<meta name="claude:/.test(l));
const body = lines.slice(cut);
const served = ['<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">', ...head, '</head>', '<body>', ...body, '</body>', '</html>', ''].join('\n');
fs.writeFileSync(path.join(ROOT, 'public', 'solo.html'), served);

console.log(`wrote data/solo.html (${(artifact.length / 1024).toFixed(0)} KB) and public/solo.html (${(served.length / 1024).toFixed(0)} KB): ${db.prompts.length} prompts`);
