#!/usr/bin/env node
// Dev-only offline parser: reconstructs the "Faded" handpan pattern from its PDF
// notation (pages 2-3) into scripts/faded.json, in the app's saved-pattern shape.
// NOT part of resonote.html - run manually with `node scripts/parse-faded.mjs`.
'use strict';

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PDF = 'assets/patterns/Faded (Panoramicsounds Version) - Alan Walker.pdf';
const CENTER_OFFSET = 40;

// ---------------------------------------------------------------------------
// Step 1: extract PDF text boxes for the notation pages (2-3) via pdftotext.
// ---------------------------------------------------------------------------
const xml = execFileSync('pdftotext', ['-f', '2', '-l', '3', '-bbox', PDF, '-']).toString();

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
// Step 2: classify words (note vs label) and find the 25 measures.
// ---------------------------------------------------------------------------
words.forEach(w => { w.kind = w.h >= 13 ? 'note' : 'label'; });

// Section codes ("1A","1B","2A","2B","3") are joined to a preceding "Part"
// label (see Step 4). Section "3" has no letter suffix, so as a bare digit
// it would otherwise be indistinguishable from the real measure-number label
// "3" (same font height ~10.6-11.9px). Find Part+code pairs up front and
// exclude the code word from measure-label candidates.
const allLabels = words.filter(w => w.kind === 'label');
const partCodeWords = new Set();
allLabels.filter(w => w.text === 'Part').forEach(part => {
  const code = allLabels.find(w =>
    w.page === part.page &&
    Math.abs(w.yMin - part.yMin) < 3 &&
    w.xMin > part.xMax && w.xMin - part.xMax < 25
  );
  if (code) partCodeWords.add(code);
});

const measureLabels = allLabels.filter(w =>
  !partCodeWords.has(w) && /^\d+$/.test(w.text) && +w.text >= 1 && +w.text <= 25
);

measureLabels.sort((a, b) =>
  a.page - b.page || Math.round(a.yMin) - Math.round(b.yMin) || a.xMin - b.xMin
);

const measures = measureLabels.map((lbl, idx) => ({
  idx, page: lbl.page, rowY: lbl.yMin, leftX: lbl.xMin, text: lbl.text,
}));

// The running header (song title/artist, page 1 of the notation only) and
// footer (title/artist/instrument/page-number, every page) sit outside the
// notation grid but happen to have note-height (>=13px) or label-height
// (~11-12px) glyphs, so they'd otherwise be misread as stray notes/labels.
// Bound each page's content to just above its first measure row through
// just below its last measure row's content (last-row content is observed
// to extend ~55-70px past its row label; 90px comfortably covers that while
// excluding the footer, which sits ~95-102px past the last row on both
// pages).
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

// Cell width: median of same-row leftX deltas, divided by 16 steps/measure.
const widths = [];
for (let i = 0; i < measures.length - 1; i++) {
  const a = measures[i], b = measures[i + 1];
  if (a.page === b.page && Math.abs(a.rowY - b.rowY) < 5) {
    widths.push(b.leftX - a.leftX);
  }
}
widths.sort((a, b) => a - b);
const median = widths.length
  ? (widths.length % 2
      ? widths[(widths.length - 1) / 2]
      : (widths[widths.length / 2 - 1] + widths[widths.length / 2]) / 2)
  : 267.75; // fallback (shouldn't trigger given a well-formed PDF)
const cellWidth = median / 16;

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

// Find the measure that "owns" a given (page, y, x) point: the row with the
// largest rowY <= y (notes/labels sit below their row's measure-number
// label), then within that row, the measure with the largest leftX <= x.
// A small ROW_EPS tolerates section/tempo/expression labels (Part/=/rall.)
// that are typeset ~1px above their row's measure-number label - without it
// they'd fall through to the previous row (rows are ~110px+ apart, so this
// tolerance never lets a point skip into the wrong row).
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

// Section/tempo/expression labels sit ABOVE their measure's staff (sometimes well
// above, in the inter-row gap). Attach them to the nearest row whose measure-number
// label is at or below the mark (the row the mark sits above), then the measure by x.
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
const noteWords = contentWords.filter(w => w.kind === 'note');
const grid = {};
const unknown = [];
let maxRoundingError = 0;

// First pass: raw sub-cell offset of every note from its measure's label. The
// measure-number label sits a constant fraction of a cell left of the true
// cell-0 (downbeat) column, so raw = (cx-leftX)/cellWidth carries a systematic
// sub-cell PHASE (~0.64 for this PDF). Left uncorrected it rounds the downbeat
// up to step 1 and shifts the whole song one 16th late. Estimate PHASE as the
// median fractional part across all notes and subtract it so notes land on
// their true cells (downbeats on 0, 4, 8, 12).
const placed = [];
for (const note of noteWords) {
  const m = findMeasureForPoint(note.page, note.yMin, note.cx);
  if (!m) continue;
  placed.push({ note, m, raw: (note.cx - m.leftX) / cellWidth });
}
const fracs = placed.map(p => ((p.raw % 1) + 1) % 1).sort((a, b) => a - b);
const PHASE = fracs.length ? fracs[Math.floor(fracs.length / 2)] : 0;

// Second pass: assign phase-corrected step / hand / voice.
for (const { note, m, raw } of placed) {
  const corrected = raw - PHASE;
  const stepRaw = Math.round(corrected);
  const step = Math.min(15, Math.max(0, stepRaw));
  maxRoundingError = Math.max(maxRoundingError, Math.abs(corrected - stepRaw));
  const globalStep = m.idx * 16 + step;

  const hand = note.cy > (m.rowY + CENTER_OFFSET) ? 'L' : 'R';

  const token = note.text;
  const voice = token === 'D' ? 'D'
    : token === 'K' ? 'S'
    : /^([1-9]|1[0-2])$/.test(token) ? token
    : null;

  if (voice === null) {
    unknown.push({ page: note.page, text: token, xMin: note.xMin, yMin: note.yMin });
    continue;
  }

  grid[globalStep] = grid[globalStep] || {};
  grid[globalStep][voice] = hand;
}
console.log('phase (sub-cell offset subtracted):', PHASE.toFixed(3));

// ---------------------------------------------------------------------------
// Step 4: sections, tempo, expression.
// ---------------------------------------------------------------------------
const marks = {};

// Sections: "Part" label followed closely (same row, small x gap) by a code
// label ("1A","1B","2A","2B","3") -> attach to the leftmost measure of that row.
const labelWords = contentWords.filter(w => w.kind === 'label');
const partWords = labelWords.filter(w => w.text === 'Part');
for (const part of partWords) {
  const code = labelWords.find(w =>
    w.page === part.page &&
    Math.abs(w.yMin - part.yMin) < 3 &&
    w.xMin > part.xMax && w.xMin - part.xMax < 25
  );
  if (!code) continue;
  const m = findMeasureForLabelAbove(part.page, part.yMin, part.xMin);
  if (!m) continue;
  marks[m.idx] = marks[m.idx] || {};
  marks[m.idx].section = `Part ${code.text}`;
}

// Tempo: "=" label followed closely by a number label. First occurrence
// (document order: page, yMin, xMin) sets the global tempo; every later
// occurrence sets marks[m.idx].tempo for its own measure.
const eqWords = labelWords.filter(w => w.text === '=');
const tempoEvents = [];
for (const eq of eqWords) {
  const num = labelWords.find(w =>
    w.page === eq.page &&
    Math.abs(w.yMin - eq.yMin) < 3 &&
    w.xMin > eq.xMax && w.xMin - eq.xMax < 15 &&
    /^\d+$/.test(w.text)
  );
  if (!num) continue;
  tempoEvents.push({ page: eq.page, yMin: eq.yMin, xMin: eq.xMin, value: +num.text });
}
tempoEvents.sort((a, b) => a.page - b.page || a.yMin - b.yMin || a.xMin - b.xMin);

let tempo = 90; // fallback matching the brief's expected value
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
const rallWords = labelWords.filter(w => w.text === 'rall.');
for (const w of rallWords) {
  const m = findMeasureForLabelAbove(w.page, w.yMin, w.xMin);
  if (!m) continue;
  marks[m.idx] = marks[m.idx] || {};
  marks[m.idx].expr = 'rall.';
}

// ---------------------------------------------------------------------------
// Instrument (hard-coded, from PDF page 1: "DKurd 13 Opsilon").
// ---------------------------------------------------------------------------
const instrument = {
  name: 'DKurd 13 Opsilon', ding: 'D3', fields: [
    { note: 'A3', bottom: false }, { note: 'Bb3', bottom: false }, { note: 'C4', bottom: false },
    { note: 'D4', bottom: false }, { note: 'E4', bottom: false }, { note: 'F4', bottom: false },
    { note: 'G4', bottom: false }, { note: 'A4', bottom: false }, { note: 'C5', bottom: false },
    { note: 'D5', bottom: false }, { note: 'F3', bottom: true }, { note: 'G3', bottom: true },
  ],
};

// ---------------------------------------------------------------------------
// Emit scripts/faded.json
// ---------------------------------------------------------------------------
const pattern = {
  name: 'Faded',
  artist: 'Alan Walker (PANoramicSounds Version)',
  instrument,
  tempo,
  beats: 4,
  sub: 4,
  measures: 25,
  marks,
  grid,
  v: 3,
};

writeFileSync('scripts/faded.json', JSON.stringify(pattern, null, 2) + '\n');

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
console.log('cellWidth:', cellWidth.toFixed(4));
console.log('unknown:', JSON.stringify(unknown));
console.log('max rounding error:', maxRoundingError.toFixed(4));
console.log('grid steps filled:', Object.keys(grid).length);
console.log('measure-1 R:', m0R);
console.log('measure-1 L:', m0L);
console.log('global tempo:', tempo);
console.log('wrote scripts/faded.json');
