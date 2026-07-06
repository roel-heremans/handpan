#!/usr/bin/env node
// Dev-only offline parser: reconstructs the "Die Arpeggios von Yann Tiersen"
// handpan pattern from its PDF notation (pages 2-4) into scripts/tiersen.json,
// in the app's saved-pattern shape.
// NOT part of resonote.html - run manually with `node scripts/parse-tiersen.mjs`.
'use strict';

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PDF = 'assets/patterns/Die Arpeggios Von Yann Tiersen - Paul Erdmann.pdf';
const CENTER_OFFSET = 40;
const MEASURE_COUNT = 29;

// ---------------------------------------------------------------------------
// Step 1: extract PDF text boxes for the notation pages (2-4) via pdftotext.
// ---------------------------------------------------------------------------
const xml = execFileSync('pdftotext', ['-f', '2', '-l', '4', '-bbox', PDF, '-']).toString();

const pageChunks = xml.split('<page').slice(1); // drop head/doctype before first <page

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
// Step 2: identify section labels, then find the 29 measures.
// ---------------------------------------------------------------------------
// Font heights: measure numbers ~11px, note tokens ~14px, SECTION labels ~15px
// (title ~27, byline ~20 - both excluded by the page bounds below). Section
// labels come in two forms: "A" "-" "N" typeset as three adjacent taller words
// (=> "A-N"), and a standalone "Outro". Collect them up front so they are
// (a) excluded from note assignment and (b) turned into section marks. Without
// this the section "N" (1-6) would be misread as a stray tone-field note.
const SECTION_H = 14.5; // taller than notes (~14), separates section from note
const sectionWords = new Set();
const sectionMarks = []; // {page, yMin, xMin, label}

words.filter(w => w.text === 'Outro').forEach(w => {
  sectionWords.add(w);
  sectionMarks.push({ page: w.page, yMin: w.yMin, xMin: w.xMin, label: 'Outro' });
});

words.filter(w => w.text === 'A' && w.h >= SECTION_H).forEach(a => {
  const dash = words.find(w =>
    w.page === a.page && w.text === '-' &&
    Math.abs(w.yMin - a.yMin) < 4 && w.xMin > a.xMax && w.xMin - a.xMax < 20);
  if (!dash) return;
  const num = words.find(w =>
    w.page === a.page && /^\d+$/.test(w.text) && w.h >= SECTION_H &&
    Math.abs(w.yMin - a.yMin) < 4 && w.xMin > dash.xMax && w.xMin - dash.xMax < 20);
  if (!num) return;
  sectionWords.add(a); sectionWords.add(dash); sectionWords.add(num);
  sectionMarks.push({ page: a.page, yMin: a.yMin, xMin: a.xMin, label: `A-${num.text}` });
});

// Measure-number labels: the short (~11px) plain-integer glyphs, 1..29. Section
// numbers are taller (~15px) so they are already excluded here.
const measureLabels = words.filter(w =>
  w.h < 13 && /^\d+$/.test(w.text) && +w.text >= 1 && +w.text <= MEASURE_COUNT
);

measureLabels.sort((a, b) =>
  a.page - b.page || Math.round(a.yMin) - Math.round(b.yMin) || a.xMin - b.xMin
);

const measures = measureLabels.map((lbl, idx) => ({
  idx, page: lbl.page, rowY: lbl.yMin, leftX: lbl.xMin, text: lbl.text,
}));

// The running header (title/byline, first notation page) and footer (page
// number "n/3", a "|" divider, credits - all on the y~573 line) sit outside the
// staff but carry note/label-height glyphs, so bound each page's content to
// just above its first measure row through ~90px below its last row.
const TOP_MARGIN = 5;
const BOTTOM_MARGIN = 90;
const pageBounds = new Map(); // page -> {lo, hi}
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

// Rows: per page, the distinct rowY values (sorted) and their measures.
const rowsByPage = new Map(); // page -> sorted [rowY,...]
const measuresByPageRow = new Map(); // `${page}|${rowY}` -> [measure,...] sorted by leftX
measures.forEach(m => {
  if (!rowsByPage.has(m.page)) rowsByPage.set(m.page, new Set());
  rowsByPage.get(m.page).add(m.rowY);
  const key = `${m.page}|${m.rowY}`;
  if (!measuresByPageRow.has(key)) measuresByPageRow.set(key, []);
  measuresByPageRow.get(key).push(m);
});
rowsByPage.forEach((set, page) => rowsByPage.set(page, [...set].sort((a, b) => a - b)));
measuresByPageRow.forEach(list => list.sort((a, b) => a.leftX - b.leftX));

// Per-measure cell width. Tiersen's measure widths vary (~261 for full rows,
// ~348-368 for the sparse Outro rows), so a single global width would misplace
// the wide measures. Each measure's width is the gap to the next measure on its
// row; the last measure of a row inherits the median full-measure width.
const rowGaps = [];
measuresByPageRow.forEach(list => {
  for (let i = 0; i < list.length - 1; i++) rowGaps.push(list[i + 1].leftX - list[i].leftX);
});
rowGaps.sort((a, b) => a - b);
const medianGap = rowGaps.length ? rowGaps[Math.floor(rowGaps.length / 2)] : 261;
measures.forEach(m => {
  const row = measuresByPageRow.get(`${m.page}|${m.rowY}`);
  const i = row.indexOf(m);
  const width = i < row.length - 1 ? row[i + 1].leftX - m.leftX : medianGap;
  m.cellWidth = width / 16;
});

// Find the measure that "owns" a given (page, y, x) point: the row with the
// largest rowY <= y (notes/labels sit below their row's measure-number label),
// then within that row, the measure with the largest leftX <= x. A small ROW_EPS
// tolerates section/tempo labels typeset ~1px above their row's number label.
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

// Section/tempo/expression labels sit ABOVE their measure's staff. Attach them
// to the nearest row whose measure-number label is at or below the mark.
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
// Step 3: assign notes to (measure, step, hand, voice).
// ---------------------------------------------------------------------------
// Notes are the ~14px glyphs, minus the taller (~15px) section words. Measure
// numbers (~11px) and everything outside the page bounds are already excluded.
const noteWords = contentWords.filter(w => w.h >= 13 && w.h < SECTION_H && !sectionWords.has(w));
const grid = {};
const unknown = [];
let maxRoundingError = 0;

// First pass: raw sub-cell offset of every note from its measure's label. The
// measure-number label sits a constant fraction of a cell left of the true
// cell-0 column, so raw carries a systematic sub-cell PHASE. Estimate PHASE as
// the median fractional part across all notes and subtract it so notes land on
// their true cells (downbeats on 0, 4, 8, 12).
const placed = [];
for (const note of noteWords) {
  const m = findMeasureForPoint(note.page, note.yMin, note.cx);
  if (!m) continue;
  placed.push({ note, m, raw: (note.cx - m.leftX) / m.cellWidth });
}
const fracs = placed.map(p => ((p.raw % 1) + 1) % 1).sort((a, b) => a - b);
const PHASE = fracs.length ? fracs[Math.floor(fracs.length / 2)] : 0;

// Valid voices for a D Kurd 8+1: ding (D), ding-shoulder (d), the percussion
// strokes the app knows (t/s/g), and tone fields 1-8. A bare "*" marks the
// Outro measures with a footnote reference (not a played note) - ignore it
// quietly; anything else genuinely unexpected is flagged.
const STROKE = { D: 'D', d: 'd', t: 't', s: 's', g: 'g' };
const IGNORE = new Set(['*']);
const ignored = [];
const collisions = [];
let worst = null;

// Second pass: assign phase-corrected step / hand / voice.
for (const { note, m, raw } of placed) {
  const corrected = raw - PHASE;
  const stepRaw = Math.round(corrected);
  const step = Math.min(15, Math.max(0, stepRaw));
  const err = Math.abs(corrected - stepRaw);
  if (err > maxRoundingError) { maxRoundingError = err; worst = { m: m.idx + 1, token: note.text, step, err }; }
  const globalStep = m.idx * 16 + step;

  const hand = note.cy > (m.rowY + CENTER_OFFSET) ? 'L' : 'R';

  const token = note.text;
  if (IGNORE.has(token)) { ignored.push({ page: note.page, text: token, measure: m.idx + 1 }); continue; }
  const voice = STROKE[token] || (/^[1-8]$/.test(token) ? token : null);

  if (voice === null) {
    unknown.push({ page: note.page, text: token, xMin: note.xMin.toFixed(0), yMin: note.yMin.toFixed(0) });
    continue;
  }

  grid[globalStep] = grid[globalStep] || {};
  // Both-hands unison: the same voice struck by R and L at one step can't be
  // represented (grid[step][voice] holds a single hand). Record the clash and
  // keep the right hand (the melodic/annotated stroke in this arrangement).
  if (grid[globalStep][voice] && grid[globalStep][voice] !== hand) {
    collisions.push({ measure: m.idx + 1, step, voice, kept: 'R' });
    grid[globalStep][voice] = 'R';
  } else {
    grid[globalStep][voice] = hand;
  }
}
console.log('phase (sub-cell offset subtracted):', PHASE.toFixed(3));

// ---------------------------------------------------------------------------
// Step 4: sections, tempo, expression.
// ---------------------------------------------------------------------------
const marks = {};

for (const s of sectionMarks) {
  const m = findMeasureForLabelAbove(s.page, s.yMin, s.xMin);
  if (!m) continue;
  marks[m.idx] = marks[m.idx] || {};
  marks[m.idx].section = s.label;
}

// Tempo: "=" label followed closely by a number label. First occurrence
// (document order) sets the global tempo; later occurrences set a per-measure
// tempo mark.
const labelWords = contentWords.filter(w => w.h < 13);
const eqWords = contentWords.filter(w => w.text === '=');
const tempoEvents = [];
for (const eq of eqWords) {
  const num = contentWords.find(w =>
    w.page === eq.page && /^\d+$/.test(w.text) &&
    Math.abs(w.yMin - eq.yMin) < 4 && w.xMin > eq.xMax && w.xMin - eq.xMax < 20
  );
  if (!num) continue;
  tempoEvents.push({ page: eq.page, yMin: eq.yMin, xMin: eq.xMin, value: +num.text });
}
tempoEvents.sort((a, b) => a.page - b.page || a.yMin - b.yMin || a.xMin - b.xMin);

let tempo = 53; // fallback matching the PDF's opening tempo
tempoEvents.forEach((ev, i) => {
  if (i === 0) {
    tempo = ev.value;
  } else {
    const m = findMeasureForLabelAbove(ev.page, ev.yMin, ev.xMin);
    if (m) {
      marks[m.idx] = marks[m.idx] || {};
      marks[m.idx].tempo = ev.value;
    }
  }
});

// Expression: "rall." label -> attach to its measure.
const rallWords = contentWords.filter(w => w.text === 'rall.');
for (const w of rallWords) {
  const m = findMeasureForLabelAbove(w.page, w.yMin, w.xMin);
  if (!m) continue;
  marks[m.idx] = marks[m.idx] || {};
  marks[m.idx].expr = 'rall.';
}

// ---------------------------------------------------------------------------
// Instrument (hard-coded, from PDF page 1: "D Kurd 8+1").
// ---------------------------------------------------------------------------
const instrument = {
  name: 'D Kurd 8+1', ding: 'D3', fields: [
    { note: 'A3', bottom: false }, { note: 'Bb3', bottom: false }, { note: 'C4', bottom: false },
    { note: 'D4', bottom: false }, { note: 'E4', bottom: false }, { note: 'F4', bottom: false },
    { note: 'G4', bottom: false }, { note: 'A4', bottom: false },
  ],
};

// ---------------------------------------------------------------------------
// Emit scripts/tiersen.json
// ---------------------------------------------------------------------------
const pattern = {
  name: 'Die Arpeggios von Yann Tiersen',
  artist: 'Paul Erdmann',
  instrument,
  tempo,
  beats: 4,
  sub: 4,
  measures: MEASURE_COUNT,
  marks,
  grid,
  v: 3,
};

writeFileSync('scripts/tiersen.json', JSON.stringify(pattern, null, 2) + '\n');

// ---------------------------------------------------------------------------
// Step 5: self-checks.
// ---------------------------------------------------------------------------
const m0R = [], m0L = [];
Object.keys(grid).forEach(step => {
  if (Math.floor(+step / 16) !== 0) return;
  const cell = grid[step];
  Object.keys(cell).forEach(v => (cell[v] === 'R' ? m0R : m0L).push(v));
});

console.log('measures:', measures.length);
console.log('median measure gap:', medianGap.toFixed(1));
console.log('sections:', JSON.stringify(sectionMarks.map(s => s.label)));
console.log('unknown:', JSON.stringify(unknown));
console.log('ignored (* annotations):', JSON.stringify(ignored));
console.log('both-hands unison collisions (kept R):', JSON.stringify(collisions));
console.log('max rounding error:', maxRoundingError.toFixed(4), 'at', JSON.stringify(worst));
console.log('grid steps filled:', Object.keys(grid).length);
console.log('measure-1 R:', m0R);
console.log('measure-1 L:', m0L);
console.log('global tempo:', tempo);
console.log('marks:', JSON.stringify(marks));
console.log('wrote scripts/tiersen.json');
