#!/usr/bin/env node
// Dev-only offline parser: reconstructs "Hijo de la Luna" (Mecano) from its PDF
// notation (pages 2-5) into scripts/hijo.json, in the app's saved-pattern shape.
// NOT part of resonote.html - run manually with `node scripts/parse-hijo.mjs`.
'use strict';

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PDF = 'assets/patterns/Hijo De La Luna - Mecano.pdf';
// The staff carries up to 3 note lines (R on top; two L lines for low bass
// notes). The center split sits between the top (R) line and the first L line;
// 43 keeps the tight 3-line rows on the right sides of the split.
const CENTER_OFFSET = 43;
const BEATS = 3, SUB = 2, SPM = BEATS * SUB; // 3/4 -> 6 subdivision columns

// ---------------------------------------------------------------------------
// Step 1: extract PDF text boxes for the notation pages (2-5).
// ---------------------------------------------------------------------------
const xml = execFileSync('pdftotext', ['-f', '2', '-l', '5', '-bbox', PDF, '-']).toString();
const pageChunks = xml.split('<page').slice(1);
const WORD_RE = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;

const words = [];
pageChunks.forEach((chunk, page) => {
  let m;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(chunk))) {
    const [, xMinS, yMinS, xMaxS, yMaxS, text] = m;
    const xMin = parseFloat(xMinS), yMin = parseFloat(yMinS);
    const xMax = parseFloat(xMaxS), yMax = parseFloat(yMaxS);
    words.push({
      page, text,
      xMin, yMin, xMax, yMax,
      w: xMax - xMin, h: yMax - yMin,
      cx: (xMin + xMax) / 2, cy: (yMin + yMax) / 2,
    });
  }
});

// ---------------------------------------------------------------------------
// Step 2: find the measures. Measure numbers are the short (~11px) integers.
// Two kinds of impostor slip in: tempo values typeset just right of a "="
// (e.g. "= 132", "= 104"), and a bar-reference "39" printed inside a navigation
// note. Drop the tempo values (adjacent to "="), then keep only the strictly
// increasing run so the out-of-order reference is discarded and 1..N remain.
// ---------------------------------------------------------------------------
const eqWords = words.filter(w => w.text === '=');
const isTempoValue = w => eqWords.some(eq =>
  eq.page === w.page && Math.abs(w.yMin - eq.yMin) < 4 && w.xMin > eq.xMax && w.xMin - eq.xMax < 25);

let cand = words.filter(w =>
  w.h < 12 && /^\d+$/.test(w.text) && +w.text >= 1 && +w.text <= 125 && !isTempoValue(w));
cand.sort((a, b) => a.page - b.page || Math.round(a.yMin) - Math.round(b.yMin) || a.xMin - b.xMin);

const measureLabels = [];
let last = 0;
for (const c of cand) { if (+c.text > last) { measureLabels.push(c); last = +c.text; } }
const MEASURE_COUNT = measureLabels.length;

const measures = measureLabels.map((lbl, idx) => ({
  idx, page: lbl.page, rowY: lbl.yMin, leftX: lbl.xMin, text: lbl.text,
}));

// Content bounds: section labels ("INTRO", "VERSE") sit ~35px above the first
// row; reach up for them, exclude title/byline (~100px above) and footer.
const TOP_MARGIN = 48;
const BOTTOM_MARGIN = 70;
const pageBounds = new Map();
measures.forEach(m => {
  const b = pageBounds.get(m.page) || { lo: Infinity, hi: -Infinity };
  b.lo = Math.min(b.lo, m.rowY);
  b.hi = Math.max(b.hi, m.rowY);
  pageBounds.set(m.page, b);
});
pageBounds.forEach(b => { b.lo -= TOP_MARGIN; b.hi += BOTTOM_MARGIN; });
const contentWords = words.filter(w => {
  const b = pageBounds.get(w.page);
  return b && w.yMax >= b.lo && w.yMin <= b.hi;
});

// Rows + per-measure cell width.
const rowsByPage = new Map();
const measuresByPageRow = new Map();
measures.forEach(m => {
  if (!rowsByPage.has(m.page)) rowsByPage.set(m.page, new Set());
  rowsByPage.get(m.page).add(m.rowY);
  const key = `${m.page}|${m.rowY}`;
  if (!measuresByPageRow.has(key)) measuresByPageRow.set(key, []);
  measuresByPageRow.get(key).push(m);
});
rowsByPage.forEach((set, page) => rowsByPage.set(page, [...set].sort((a, b) => a - b)));
measuresByPageRow.forEach(list => list.sort((a, b) => a.leftX - b.leftX));

const rowGaps = [];
measuresByPageRow.forEach(list => {
  for (let i = 0; i < list.length - 1; i++) rowGaps.push(list[i + 1].leftX - list[i].leftX);
});
rowGaps.sort((a, b) => a - b);
const medianGap = rowGaps.length ? rowGaps[Math.floor(rowGaps.length / 2)] : 98;
measures.forEach(m => {
  const row = measuresByPageRow.get(`${m.page}|${m.rowY}`);
  const i = row.indexOf(m);
  const width = i < row.length - 1 ? row[i + 1].leftX - m.leftX : medianGap;
  m.cellWidth = width / SPM;
});

const ROW_EPS = 3;
function findMeasureForPoint(page, y, x) {
  const rows = rowsByPage.get(page) || [];
  let rowY = rows[0];
  for (const r of rows) { if (r <= y + ROW_EPS) rowY = r; else break; }
  const rowMeasures = measuresByPageRow.get(`${page}|${rowY}`) || [];
  let chosen = rowMeasures[0];
  for (const m of rowMeasures) { if (m.leftX <= x) chosen = m; else break; }
  return chosen;
}
function findMeasureForLabelAbove(page, y, x) {
  const rows = rowsByPage.get(page) || [];
  let rowY = rows.length ? rows[rows.length - 1] : null;
  for (const r of rows) { if (r >= y - ROW_EPS) { rowY = r; break; } }
  const rowMeasures = measuresByPageRow.get(`${page}|${rowY}`) || [];
  let chosen = rowMeasures[0];
  for (const m of rowMeasures) { if (m.leftX <= x) chosen = m; else break; }
  return chosen;
}

// ---------------------------------------------------------------------------
// Step 3: assign notes. Notes are the ~14px glyphs; section labels (~15px),
// measure numbers (~11px), and out-of-bounds text are excluded by the window.
// ---------------------------------------------------------------------------
const noteWords = contentWords.filter(w => w.h >= 13 && w.h < 14.5);
const grid = {};
const unknown = [];
const collisions = [];
let maxRoundingError = 0;

const placed = [];
for (const note of noteWords) {
  const m = findMeasureForPoint(note.page, note.yMin, note.cx);
  if (!m) continue;
  placed.push({ note, m, raw: (note.cx - m.leftX) / m.cellWidth });
}
const fracs = placed.map(p => ((p.raw % 1) + 1) % 1).sort((a, b) => a - b);
const PHASE = fracs.length ? fracs[Math.floor(fracs.length / 2)] : 0;

const STROKE = { D: 'D', d: 'd', t: 't', s: 's', g: 'g' };

for (const { note, m, raw } of placed) {
  const corrected = raw - PHASE;
  const stepRaw = Math.round(corrected);
  const step = Math.min(SPM - 1, Math.max(0, stepRaw));
  maxRoundingError = Math.max(maxRoundingError, Math.abs(corrected - stepRaw));
  const globalStep = m.idx * SPM + step;

  const hand = note.cy > (m.rowY + CENTER_OFFSET) ? 'L' : 'R';

  const token = note.text;
  const voice = STROKE[token] || (/^[1-9]$/.test(token) ? token : null);
  if (voice === null) {
    unknown.push({ page: note.page, text: token, xMin: note.xMin.toFixed(0), yMin: note.yMin.toFixed(0) });
    continue;
  }

  grid[globalStep] = grid[globalStep] || {};
  if (grid[globalStep][voice] && grid[globalStep][voice] !== hand) {
    collisions.push({ measure: m.idx + 1, step, voice });
    grid[globalStep][voice] = 'R';
  } else {
    grid[globalStep][voice] = hand;
  }
}

// ---------------------------------------------------------------------------
// Step 4: sections, tempo, expression.
// ---------------------------------------------------------------------------
const marks = {};
function addMark(page, y, x, kv) {
  const m = findMeasureForLabelAbove(page, y, x);
  if (!m) return;
  marks[m.idx] = marks[m.idx] || {};
  Object.assign(marks[m.idx], kv);
}

// Section headers sit at the left of a row (~15px). Navigation phrases
// ("BRIDGE TO ...", "Go from here to END") sit to the right and are skipped.
const SEC_NAMES = new Set(['INTRO', 'VERSE', 'CHORUS', 'S-1', 'S-2', 'END']);
const secWords = contentWords
  .filter(w => w.h >= 14.5 && w.h < 17 && w.xMin < 160 && SEC_NAMES.has(w.text))
  .sort((a, b) => a.page - b.page || a.yMin - b.yMin || a.xMin - b.xMin);
const secByMeasure = {};
for (const w of secWords) {
  let label = w.text;
  if (w.text === 'VERSE') {
    const num = contentWords.find(n =>
      /^\d+$/.test(n.text) && n.h >= 14.5 && n.h < 17 && n.page === w.page &&
      Math.abs(n.yMin - w.yMin) < 4 && n.xMin > w.xMax && n.xMin - w.xMax < 30);
    if (num) label = `VERSE ${num.text}`;
  }
  const m = findMeasureForLabelAbove(w.page, w.yMin, w.xMin);
  if (!m) continue;
  (secByMeasure[m.idx] = secByMeasure[m.idx] || []).push(label);
}
for (const idx in secByMeasure) {
  marks[idx] = marks[idx] || {};
  marks[idx].section = [...new Set(secByMeasure[idx])].join(' · ');
}

// Tempo: every "= N". The first sets the global tempo; later ones are per-measure.
const tempoEvents = [];
for (const eq of eqWords) {
  const num = words.find(w =>
    w.page === eq.page && /^\d+$/.test(w.text) &&
    Math.abs(w.yMin - eq.yMin) < 4 && w.xMin > eq.xMax && w.xMin - eq.xMax < 25);
  if (num) tempoEvents.push({ page: eq.page, yMin: eq.yMin, xMin: eq.xMin, value: +num.text });
}
tempoEvents.sort((a, b) => a.page - b.page || a.yMin - b.yMin || a.xMin - b.xMin);
let tempo = 132;
tempoEvents.forEach((ev, i) => {
  if (i === 0) tempo = ev.value;
  else addMark(ev.page, ev.yMin, ev.xMin, { tempo: ev.value });
});

// Expression: "rall." -> its measure.
for (const w of contentWords.filter(w => w.text === 'rall.')) {
  addMark(w.page, w.yMin, w.xMin, { expr: 'rall.' });
}

// ---------------------------------------------------------------------------
// Instrument (from PDF page 1: "D Kurd 9+1").
// ---------------------------------------------------------------------------
const instrument = {
  name: 'D Kurd 9+1', ding: 'D3', fields: [
    { note: 'A3', bottom: false }, { note: 'Bb3', bottom: false }, { note: 'C4', bottom: false },
    { note: 'D4', bottom: false }, { note: 'E4', bottom: false }, { note: 'F4', bottom: false },
    { note: 'G4', bottom: false }, { note: 'A4', bottom: false }, { note: 'C5', bottom: false },
  ],
};

// ---------------------------------------------------------------------------
// Emit scripts/hijo.json
// ---------------------------------------------------------------------------
const pattern = {
  name: 'Hijo de la Luna',
  artist: 'Mecano',
  instrument,
  tempo,
  beats: BEATS,
  sub: SUB,
  measures: MEASURE_COUNT,
  marks,
  grid,
  v: 3,
};
writeFileSync('scripts/hijo.json', JSON.stringify(pattern, null, 2) + '\n');

// ---------------------------------------------------------------------------
// Step 5: self-checks.
// ---------------------------------------------------------------------------
console.log('measures:', MEASURE_COUNT, '| steps/measure:', SPM);
console.log('median measure gap:', medianGap.toFixed(1));
console.log('phase:', PHASE.toFixed(3));
console.log('unknown:', JSON.stringify(unknown));
console.log('collisions:', JSON.stringify(collisions));
console.log('max rounding error:', maxRoundingError.toFixed(4));
console.log('grid steps filled:', Object.keys(grid).length);
console.log('tempo:', tempo, '| tempo events:', JSON.stringify(tempoEvents.map(e => e.value)));
console.log('marks:', JSON.stringify(marks));
console.log('wrote scripts/hijo.json');
