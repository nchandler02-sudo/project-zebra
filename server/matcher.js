'use strict';
/**
 * Clinical answer matcher.
 *
 * Pipeline for one typed answer against one prompt's answer list:
 *   1. normalize (case, accents, possessives, punctuation, parentheticals, abbreviations)
 *   2. exact match on a canonical name or alias
 *   3. word-order-insensitive match
 *   4. match ignoring a trailing generic word (disease / syndrome / ...), only if unambiguous
 *   5. acronyms: a built-in dictionary of common clinical abbreviations (SLE, DKA, AKI, COPD ...) plus automatic
 *      initialisms of each answer's own words. An acronym with two readings (MS, PE) only matches when exactly
 *      one of the readings is on this prompt's list.
 *   6. loose spelling match: British/Latin spellings (anaemia, oedema, foetal), ph/f, ck/k, doubled letters,
 *      missing spaces and plurals are ignored ("feochromocytoma", "hyponatremmia", "multiplesclerosis")
 *   7. fuzzy match: Damerau-Levenshtein similarity >= 0.82, with guards
 *        - digits and single-letter tokens must agree (anti-Ma1 vs anti-Ma2, GABA-A vs GABA-B)
 *        - if two different answers are both above threshold and within 0.02 of each other,
 *          the input is "ambiguous" and is NOT matched (the player is asked to be more specific)
 *   8. word-by-word fuzzy match: every word may carry one typo (two in long words), so short answers like
 *      "lupus" or "gout" and multi-word answers with several small typos are accepted
 *   Opposites are never fuzzed together (hyper/hypo, micro/macro, supra/infra, intra/extra) and a typed word never
 *   matches a different digit or letter ("type 1" / "type 2", "hepatitis B" / "hepatitis C").
 *
 * The normalization is mirrored by tools/mksap_abim_parser.py so alias collisions are caught at build time.
 * This file has no dependencies so tools/build_solo.js can embed it in the standalone page.
 */

const FUZZY_THRESHOLD = 0.82;
const AMBIGUITY_GAP = 0.02;
const MAX_INPUT_LEN = 120;

const TOKEN_EXPANSIONS = { dz: 'disease', synd: 'syndrome', ab: 'antibody', abs: 'antibodies' };
const LEADING_ARTICLES = new Set(['the', 'a', 'an']);
const GENERIC_SUFFIXES = new Set([
  'disease', 'syndrome', 'infection', 'toxicity', 'antibody', 'antibodies', 'deficiency', 'sign',
]);
// Common English words are never treated as an initialism of an answer ("the", "and", "for" ...).
const COMMON_WORDS = new Set(['the', 'and', 'for', 'you', 'not', 'but', 'are', 'was', 'can', 'one', 'any', 'had', 'her', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'did', 'its', 'let', 'say', 'she', 'too', 'use', 'yes', 'dont', 'idk', 'what', 'this', 'that', 'with', 'have', 'from']);
const INITIAL_STOP = new Set(['of', 'the', 'and', 'or', 'with', 'in', 'to', 'a', 'an', 'by', 'for', 'on', 'due', 'from', 'type']);

/**
 * Common clinical abbreviations -> possible full names. A reading is used only when it matches an answer on the
 * prompt's list, so ambiguous abbreviations (MS, PE, AS, SS) resolve by context and never guess.
 */
const ACRONYMS = {
  // cardiovascular
  mi: ['myocardial infarction'], ami: ['acute myocardial infarction'], stemi: ['st elevation myocardial infarction'],
  nstemi: ['non st elevation myocardial infarction'], acs: ['acute coronary syndrome'], cad: ['coronary artery disease'],
  chf: ['congestive heart failure'], hf: ['heart failure'], hfref: ['heart failure with reduced ejection fraction'],
  hfpef: ['heart failure with preserved ejection fraction'], af: ['atrial fibrillation'], afib: ['atrial fibrillation'],
  aflutter: ['atrial flutter'], svt: ['supraventricular tachycardia'], vt: ['ventricular tachycardia'],
  vf: ['ventricular fibrillation'], vfib: ['ventricular fibrillation'], pvc: ['premature ventricular contraction'],
  wpw: ['wolff parkinson white syndrome'], lbbb: ['left bundle branch block'], rbbb: ['right bundle branch block'],
  lvh: ['left ventricular hypertrophy'], hcm: ['hypertrophic cardiomyopathy'], dcm: ['dilated cardiomyopathy'],
  htn: ['hypertension'], pah: ['pulmonary arterial hypertension'], ie: ['infective endocarditis'],
  ar: ['aortic regurgitation'], mr: ['mitral regurgitation'], tr: ['tricuspid regurgitation'],
  as: ['aortic stenosis', 'ankylosing spondylitis'], ms: ['multiple sclerosis', 'mitral stenosis'],
  asd: ['atrial septal defect'], vsd: ['ventricular septal defect'], pda: ['patent ductus arteriosus'],
  dvt: ['deep vein thrombosis'], pe: ['pulmonary embolism'], vte: ['venous thromboembolism'],
  pad: ['peripheral artery disease'], tia: ['transient ischemic attack'], cva: ['cerebrovascular accident', 'stroke'],
  // pulmonary
  copd: ['chronic obstructive pulmonary disease'], ards: ['acute respiratory distress syndrome'],
  osa: ['obstructive sleep apnea'], ild: ['interstitial lung disease'], ipf: ['idiopathic pulmonary fibrosis'],
  cap: ['community acquired pneumonia'], hap: ['hospital acquired pneumonia'], vap: ['ventilator associated pneumonia'],
  tb: ['tuberculosis'], pcp: ['pneumocystis pneumonia'], pjp: ['pneumocystis jirovecii pneumonia'],
  abpa: ['allergic bronchopulmonary aspergillosis'], gpa: ['granulomatosis with polyangiitis'],
  egpa: ['eosinophilic granulomatosis with polyangiitis'], nsip: ['nonspecific interstitial pneumonia'],
  // GI / liver
  gerd: ['gastroesophageal reflux disease'], ibd: ['inflammatory bowel disease'], ibs: ['irritable bowel syndrome'],
  uc: ['ulcerative colitis'], cd: ['crohn disease'], pud: ['peptic ulcer disease'], ugib: ['upper gastrointestinal bleeding'],
  lgib: ['lower gastrointestinal bleeding'], gib: ['gastrointestinal bleeding'], sbp: ['spontaneous bacterial peritonitis'],
  hcc: ['hepatocellular carcinoma'], pbc: ['primary biliary cholangitis'], psc: ['primary sclerosing cholangitis'],
  nafld: ['nonalcoholic fatty liver disease'], nash: ['nonalcoholic steatohepatitis'],
  masld: ['metabolic dysfunction associated steatotic liver disease'], hrs: ['hepatorenal syndrome'],
  he: ['hepatic encephalopathy'], aih: ['autoimmune hepatitis'], cdiff: ['clostridioides difficile infection', 'clostridium difficile infection'],
  'c diff': ['clostridioides difficile infection', 'clostridium difficile infection'],
  // renal / electrolytes
  aki: ['acute kidney injury'], ckd: ['chronic kidney disease'], esrd: ['end stage renal disease'],
  atn: ['acute tubular necrosis'], ain: ['acute interstitial nephritis'], gn: ['glomerulonephritis'],
  fsgs: ['focal segmental glomerulosclerosis'], mcd: ['minimal change disease'], hus: ['hemolytic uremic syndrome'],
  rta: ['renal tubular acidosis'], siadh: ['syndrome of inappropriate antidiuretic hormone secretion'],
  di: ['diabetes insipidus'], uti: ['urinary tract infection'], bph: ['benign prostatic hyperplasia'],
  adpkd: ['autosomal dominant polycystic kidney disease'],
  // endocrine
  dm: ['diabetes mellitus'], t1dm: ['type 1 diabetes mellitus'], t2dm: ['type 2 diabetes mellitus'],
  dka: ['diabetic ketoacidosis'], hhs: ['hyperosmolar hyperglycemic state'], cah: ['congenital adrenal hyperplasia'],
  pcos: ['polycystic ovary syndrome'], men: ['multiple endocrine neoplasia'],
  // heme / onc
  dic: ['disseminated intravascular coagulation'], itp: ['immune thrombocytopenia', 'idiopathic thrombocytopenic purpura'],
  ttp: ['thrombotic thrombocytopenic purpura'], hit: ['heparin induced thrombocytopenia'],
  pnh: ['paroxysmal nocturnal hemoglobinuria'], aiha: ['autoimmune hemolytic anemia'],
  g6pd: ['glucose 6 phosphate dehydrogenase deficiency'], mgus: ['monoclonal gammopathy of undetermined significance'],
  mm: ['multiple myeloma'], aml: ['acute myeloid leukemia'], all: ['acute lymphoblastic leukemia'],
  cml: ['chronic myeloid leukemia'], cll: ['chronic lymphocytic leukemia'], dlbcl: ['diffuse large b cell lymphoma'],
  nhl: ['non hodgkin lymphoma'], mds: ['myelodysplastic syndrome'], pv: ['polycythemia vera'],
  tls: ['tumor lysis syndrome'], hlh: ['hemophagocytic lymphohistiocytosis'], vwd: ['von willebrand disease'],
  // infectious disease
  hiv: ['human immunodeficiency virus infection'], aids: ['acquired immunodeficiency syndrome'], cmv: ['cytomegalovirus'],
  ebv: ['epstein barr virus'], hsv: ['herpes simplex virus'], vzv: ['varicella zoster virus'],
  hbv: ['hepatitis b virus'], hcv: ['hepatitis c virus'], mrsa: ['methicillin resistant staphylococcus aureus'],
  vre: ['vancomycin resistant enterococcus'], rmsf: ['rocky mountain spotted fever'], pid: ['pelvic inflammatory disease'],
  // rheum / neuro / derm
  sle: ['systemic lupus erythematosus'], ra: ['rheumatoid arthritis'], psa: ['psoriatic arthritis'],
  gca: ['giant cell arteritis'], pmr: ['polymyalgia rheumatica'], mctd: ['mixed connective tissue disease'],
  aps: ['antiphospholipid syndrome'], mg: ['myasthenia gravis'], gbs: ['guillain barre syndrome'],
  als: ['amyotrophic lateral sclerosis'], cjd: ['creutzfeldt jakob disease'], pml: ['progressive multifocal leukoencephalopathy'],
  nph: ['normal pressure hydrocephalus'], sah: ['subarachnoid hemorrhage'], ich: ['intracerebral hemorrhage'],
  sdh: ['subdural hematoma'], tbi: ['traumatic brain injury'], sjs: ['stevens johnson syndrome'],
  ten: ['toxic epidermal necrolysis'], dress: ['drug reaction with eosinophilia and systemic symptoms'],
  nms: ['neuroleptic malignant syndrome'], mh: ['malignant hyperthermia'], cts: ['carpal tunnel syndrome'],
  ss: ['serotonin syndrome', 'sjogren syndrome', 'systemic sclerosis'],
  // drugs and drug classes
  nsaid: ['nonsteroidal anti inflammatory drug'], nsaids: ['nonsteroidal anti inflammatory drugs'],
  acei: ['ace inhibitor', 'angiotensin converting enzyme inhibitor'], ace: ['ace inhibitor', 'ace inhibitors', 'angiotensin converting enzyme inhibitor'],
  arb: ['angiotensin receptor blocker', 'angiotensin receptor blockers'], ccb: ['calcium channel blocker', 'calcium channel blockers'],
  ppi: ['proton pump inhibitor', 'proton pump inhibitors'], ssri: ['selective serotonin reuptake inhibitor', 'ssris'],
  snri: ['serotonin norepinephrine reuptake inhibitor'], maoi: ['monoamine oxidase inhibitor', 'monoamine oxidase inhibitors'],
  tca: ['tricyclic antidepressant', 'tricyclic antidepressants'], doac: ['direct oral anticoagulant', 'direct oral anticoagulants'],
  lmwh: ['low molecular weight heparin'], ufh: ['unfractionated heparin'], asa: ['aspirin', 'acetylsalicylic acid'],
  apap: ['acetaminophen'], hctz: ['hydrochlorothiazide'], mtx: ['methotrexate'], ivig: ['intravenous immunoglobulin'],
  tmpsmx: ['trimethoprim sulfamethoxazole'], 'tmp smx': ['trimethoprim sulfamethoxazole'],
  bb: ['beta blocker', 'beta blockers'],
};

// Pairs of opposite prefixes: a typed word and an answer word that differ only by one of these are different answers.
const OPPOSITES = [['hyper', 'hypo'], ['micro', 'macro'], ['supra', 'infra'], ['intra', 'extra']];

// Look-alike words that mean different things: one is never accepted for the other, even as a typo.
const CONFUSABLE = [
  ['nephritic', 'nephrotic'], ['dysphagia', 'dysphasia'], ['dysphagia', 'dysphonia'], ['aphagia', 'aphasia'],
  ['ileus', 'ileum'], ['ureter', 'urethra'], ['arteritis', 'arthritis'], ['osteoporosis', 'osteopetrosis'],
  ['tricuspid', 'bicuspid'], ['unilateral', 'bilateral'], ['febrile', 'afebrile'], ['increased', 'decreased'],
  ['intrinsic', 'extrinsic'], ['endogenous', 'exogenous'], ['ischemia', 'anemia'], ['hypotension', 'hypertension'],
  ['colitis', 'cystitis'], ['gastritis', 'gastroenteritis'], ['uremia', 'anemia'], ['hepatic', 'hepatitis'],
  ['prostatic', 'prostatitis'], ['aortic', 'aortitis'], ['mitral', 'mitotic'], ['fibroma', 'fibrosis'],
];

function normalize(input) {
  let s = String(input == null ? '' : input).slice(0, MAX_INPUT_LEN * 2);
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/[‘’ʼ`´]/g, "'");
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/\bw\/o\b/g, ' without ').replace(/\bw\//g, ' with ').replace(/&/g, ' and ');
  s = s.replace(/(?<=[a-z0-9])'s\b/g, '').replace(/'/g, '');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!s) return '';
  const tokens = s.split(' ').map((t) => TOKEN_EXPANSIONS[t] || t);
  while (tokens.length > 1 && LEADING_ARTICLES.has(tokens[0])) tokens.shift();
  return tokens.join(' ');
}

/** Key with a trailing generic word removed ("whipple disease" -> "whipple"). */
function coreOf(norm) {
  const t = norm.split(' ');
  if (t.length > 1 && GENERIC_SUFFIXES.has(t[t.length - 1])) t.pop();
  return t.join(' ');
}

function sortedTokens(norm) {
  return norm.split(' ').sort().join(' ');
}

const NON_DIGITS = /[^0-9]/g;

/** Spelling-insensitive form: ae/oe -> e, ph -> f, ck -> k, doubled letters collapsed, spaces removed, plural s dropped. */
function loose(norm) {
  let s = norm.replace(/ae/g, 'e').replace(/oe/g, 'e').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/\s+/g, '');
  s = s.replace(/([a-z])\1+/g, '$1');
  if (s.length > 5 && s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  return s;
}
/** Same idea for one word. */
function looseToken(t) {
  return t.replace(/ae/g, 'e').replace(/oe/g, 'e').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/([a-z])\1+/g, '$1');
}

// QWERTY neighbours: a single-letter token swapped for a keyboard-adjacent letter is treated as a typo.
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
function keysAdjacent(x, y) {
  for (let r = 0; r < KEY_ROWS.length; r++) {
    const i = KEY_ROWS[r].indexOf(x);
    if (i < 0) continue;
    for (let dr = -1; dr <= 1; dr++) {
      const row = KEY_ROWS[r + dr];
      if (!row) continue;
      const j = row.indexOf(y);
      if (j >= 0 && Math.abs(j - i) <= 1 && !(dr === 0 && j === i)) return true;
    }
  }
  return false;
}

/** True when one string uses an opposite prefix where the other uses its partner ("hypocalcemia" vs "hypercalcemia"). */
function oppositeConflict(a, b) {
  for (const [x, y] of OPPOSITES) {
    if ((a.includes(x) && !a.includes(y) && b.includes(y) && !b.includes(x))
      || (a.includes(y) && !a.includes(x) && b.includes(x) && !b.includes(y))) return true;
  }
  return false;
}

/** True when the two phrases use a look-alike pair of words, one each ("nephritic syndrome" vs "nephrotic syndrome"). */
function confusable(a, b) {
  const ta = new Set(a.split(' '));
  const tb = new Set(b.split(' '));
  for (const [x, y] of CONFUSABLE) {
    if ((ta.has(x) && tb.has(y) && !ta.has(y) && !tb.has(x)) || (ta.has(y) && tb.has(x) && !ta.has(x) && !tb.has(y))) return true;
  }
  return false;
}

/**
 * Guard against fuzzing distinct names together:
 *   - the digits must agree ("anti-Ma1" is not "anti-Ma2")
 *   - a single-letter token may not be swapped for a letter that is not keyboard-adjacent ("GABA-A" vs "GABA-B")
 *   - opposite prefixes (hypo/hyper) never match each other
 * Typos like a dropped letter making "or" -> "o" are still allowed.
 */
function compatible(a, b) {
  if (a.replace(NON_DIGITS, '') !== b.replace(NON_DIGITS, '')) return false;
  if (oppositeConflict(a, b) || confusable(a, b)) return false;
  const ta = a.split(' ');
  const tb = b.split(' ');
  if (ta.length === tb.length) {
    for (let i = 0; i < ta.length; i++) {
      if (ta[i] !== tb[i] && ta[i].length === 1 && tb[i].length === 1 && !keysAdjacent(ta[i], tb[i])) return false;
    }
  }
  return true;
}

/** Optimal-string-alignment distance: Levenshtein plus adjacent transposition ("teh" -> "the" = 1). */
function distance(a, b) {
  const la = a.length;
  const lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  let prev2 = new Array(lb + 1).fill(0);
  let prev = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === cb ? 0 : 1));
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
    }
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[lb];
}

function similarity(a, b) {
  const m = Math.max(a.length, b.length);
  return m === 0 ? 1 : 1 - distance(a, b) / m;
}

/** Cost of treating word a as a misspelling of word b: null = not the same word. */
function wordCost(a, b) {
  if (a === b) return 0;
  if (a.length < 2 || b.length < 2) return null; // single letters must match exactly
  if (a.replace(NON_DIGITS, '') !== b.replace(NON_DIGITS, '')) return null;
  const la = looseToken(a);
  const lb = looseToken(b);
  if (la === lb) return 0.5; // spelling variant only
  const m = Math.min(a.length, b.length);
  if (m < 4) return null;
  if (/^[0-9]/.test(a) !== /^[0-9]/.test(b)) return null;
  const allowed = m >= 10 ? 2 : 1;
  const d = Math.min(distance(a, b), distance(la, lb) + 0.5);
  return d <= allowed ? d : null;
}

/** Total word-by-word cost of reading `input` words as the `key` words (any order), or null. */
function wordsCost(input, key) {
  const used = new Array(key.length).fill(false);
  let total = 0;
  for (const a of input) {
    let best = null;
    let bj = -1;
    for (let j = 0; j < key.length; j++) {
      if (used[j]) continue;
      const c = wordCost(a, key[j]);
      if (c !== null && (best === null || c < best)) { best = c; bj = j; }
    }
    if (best === null) return null;
    used[bj] = true;
    total += best;
  }
  return total;
}

class PromptMatcher {
  /** @param {{answers: {name: string, aliases?: string[]}[]}} prompt */
  constructor(prompt) {
    this.answers = prompt.answers;
    this.exact = new Map(); // normalized key -> answer index
    this.sorted = new Map(); // sorted-token key -> index, or -1 when two answers share it
    this.core = new Map(); // core key -> index, or -1 when two answers share it
    this.loose = new Map(); // spelling-insensitive key -> index, or -1 when two answers share it
    this.initials = new Map(); // initialism of an answer's words -> index, or -1 when ambiguous
    this.fuzzyKeys = []; // {key, idx}
    this.collisions = []; // human-readable problems found while indexing

    prompt.answers.forEach((ans, idx) => {
      const seen = new Set();
      for (const raw of [ans.name, ...(ans.aliases || [])]) {
        const key = normalize(raw);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (this.exact.has(key) && this.exact.get(key) !== idx) {
          this.collisions.push(`"${raw}" (${ans.name}) collides with "${this.answers[this.exact.get(key)].name}"`);
          continue;
        }
        this.exact.set(key, idx);
        this.fuzzyKeys.push({ key, idx });
        this._addAmbiguous(this.sorted, sortedTokens(key), idx);
        const core = coreOf(key);
        if (core !== key && core.length >= 6) {
          this._addAmbiguous(this.core, core, idx);
        }
        const lk = loose(key);
        if (lk.length >= 4) this._addAmbiguous(this.loose, lk, idx);
        this._addInitials(key, idx);
      }
    });
    // Unambiguous cores also become fuzzy targets ("wippel" -> "whipple").
    for (const [core, idx] of this.core) {
      if (idx >= 0 && !this.exact.has(core)) this.fuzzyKeys.push({ key: core, idx });
    }
    // An initialism that equals a real key (or alias) of any answer is not an initialism, it is that key.
    for (const k of this.exact.keys()) if (this.initials.has(k)) this.initials.delete(k);
  }

  _addAmbiguous(map, key, idx) {
    if (map.has(key) && map.get(key) !== idx) map.set(key, -1);
    else if (!map.has(key)) map.set(key, idx);
  }

  /** "systemic lupus erythematosus" -> "sle" (3+ letters; the generic last word may be left out). */
  _addInitials(key, idx) {
    const words = key.split(' ').filter((w) => w && !INITIAL_STOP.has(w) && /^[a-z]/.test(w));
    const variants = [words];
    if (words.length > 2 && GENERIC_SUFFIXES.has(words[words.length - 1])) variants.push(words.slice(0, -1));
    for (const w of variants) {
      if (w.length < 2) continue;
      const acr = w.map((x) => x[0]).join('');
      if (acr.length >= 3 && !COMMON_WORDS.has(acr)) this._addAmbiguous(this.initials, acr, idx);
    }
  }

  /** Strict single-answer lookup used for acronym expansions. Returns an index or -1. */
  _lookup(norm) {
    if (this.exact.has(norm)) return this.exact.get(norm);
    const st = sortedTokens(norm);
    if (this.sorted.has(st) && this.sorted.get(st) >= 0) return this.sorted.get(st);
    const c = coreOf(norm);
    if (c.length >= 6 && this.core.has(c) && this.core.get(c) >= 0) return this.core.get(c);
    const lk = loose(norm);
    if (lk.length >= 4 && this.loose.has(lk) && this.loose.get(lk) >= 0) return this.loose.get(lk);
    return -1;
  }

  match(text) {
    const norm = normalize(text);
    const none = { matched: false, index: -1, method: 'none', similarity: 0, normalized: norm };
    if (!norm) return none;
    const hit = (index, method, sim = 1) => ({ matched: true, index, method, similarity: sim, normalized: norm });

    if (this.exact.has(norm)) return hit(this.exact.get(norm), 'exact');
    const st = sortedTokens(norm);
    if (this.sorted.has(st) && this.sorted.get(st) >= 0) return hit(this.sorted.get(st), 'reordered');
    const nCore = coreOf(norm);
    if (this.core.has(nCore) && this.core.get(nCore) >= 0 && nCore.length >= 6) return hit(this.core.get(nCore), 'core');
    if (this.core.has(norm) && this.core.get(norm) >= 0) return hit(this.core.get(norm), 'core');

    // Acronyms: dictionary readings first (only readings that are on this list count), then initialisms of the list.
    const readings = ACRONYMS[norm];
    if (readings) {
      const found = new Set();
      for (const r of readings) { const i = this._lookup(normalize(r)); if (i >= 0) found.add(i); }
      if (found.size === 1) return hit([...found][0], 'acronym');
      if (found.size > 1) return { matched: false, index: -1, method: 'ambiguous', similarity: 1, normalized: norm };
    }
    const squashed = norm.replace(/ /g, '');
    if (squashed.length >= 3 && squashed.length <= 8 && this.initials.has(squashed) && this.initials.get(squashed) >= 0) {
      return hit(this.initials.get(squashed), 'acronym');
    }

    // Loose spelling: British/Latin variants, ph/f, doubled letters, missing spaces, plurals.
    const lk = loose(norm);
    if (lk.length >= 4 && this.loose.has(lk) && this.loose.get(lk) >= 0) return hit(this.loose.get(lk), 'loose');

    // Fuzzy (whole string)
    if (norm.length >= 5) {
      const probes = nCore !== norm && nCore.length >= 5 ? [norm, nCore] : [norm];
      const best = new Map(); // answer index -> best similarity
      for (const { key, idx } of this.fuzzyKeys) {
        for (const probe of probes) {
          const longest = Math.max(probe.length, key.length);
          if (Math.abs(probe.length - key.length) / longest > 1 - FUZZY_THRESHOLD) continue;
          if (!compatible(probe, key)) continue;
          const sim = similarity(probe, key);
          if (sim >= FUZZY_THRESHOLD && sim > (best.get(idx) || 0)) best.set(idx, sim);
        }
      }
      if (best.size > 0) {
        const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
        if (ranked.length > 1 && ranked[0][1] - ranked[1][1] < AMBIGUITY_GAP) {
          return { matched: false, index: -1, method: 'ambiguous', similarity: ranked[0][1], normalized: norm };
        }
        return hit(ranked[0][0], 'fuzzy', ranked[0][1]);
      }
    }

    // Word-by-word fuzzy: short answers and several small typos spread across a long answer.
    if (norm.length >= 4) {
      const words = norm.split(' ');
      const probes = nCore !== norm && nCore.length >= 4 ? [words, nCore.split(' ')] : [words];
      const cost = new Map(); // answer index -> lowest total cost
      for (const { key, idx } of this.fuzzyKeys) {
        const kw = key.split(' ');
        if (oppositeConflict(norm, key) || confusable(norm, key)) continue;
        for (const pw of probes) {
          if (pw.length !== kw.length) continue;
          const c = wordsCost(pw, kw);
          if (c !== null && c <= 3 && c < (cost.has(idx) ? cost.get(idx) : Infinity)) cost.set(idx, c);
        }
      }
      if (cost.size > 0) {
        const ranked = [...cost.entries()].sort((a, b) => a[1] - b[1]);
        if (ranked.length > 1 && ranked[1][1] - ranked[0][1] < 1) {
          return { matched: false, index: -1, method: 'ambiguous', similarity: 0.8, normalized: norm };
        }
        return hit(ranked[0][0], 'fuzzy-words', 0.8);
      }
    }
    return none;
  }
}

module.exports = { PromptMatcher, normalize, distance, similarity, coreOf, confusable, FUZZY_THRESHOLD, AMBIGUITY_GAP, ACRONYMS };
