#!/usr/bin/env node
// Dev-only offline parser: reconstructs Amy Naylor's "Handpanuary 2025 Day 1
// Relax + Flow" handpan pattern from its PDF notation (page 2) into
// scripts/amy.json, in the app's saved-pattern shape.
// NOT part of resonote.html - run manually with `node scripts/parse-amy.mjs`.
'use strict';

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PDF = 'assets/patterns/Handpanuary 2025 D-Kurd Playlist - Amy Naylor.pdf';
const CENTER_OFFSET = 40;
const MEASURE_COUNT = 9;
// Real measure-number labels render at ~10.6px. The page carries instructional
// annotations ("Turn the instrument 90 degrees...", "melodie notes 8 + 9") whose
// digits are slightly taller (~11.4-11.9px); this threshold keeps the labels and
// drops the annotation numbers so 40/90/8/9 are not mistaken for measures.
const MLABEL_H = 11.0;
const SECTION_H = 14.5; // "Part"/"A"/"B" render taller (~15px) than notes (~14px)

// ---------------------------------------------------------------------------
// Step 1: extract PDF text boxes for the notation page (2) via pdftotext.
// ---------------------------------------------------------------------------
const xml = execFileSync('pdftotext', ['-f', '2', '-l', '2', '-bbox', PDF, '-']).toString();

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
// Step 2: find the 9 measures (short ~10.6px numeric labels).
// ---------------------------------------------------------------------------
const measureLabels = words.filter(w =>
  w.h < MLABEL_H && /^\d+$/.test(w.text) && +w.text >= 1 && +w.text <= MEASURE_COUNT
);
measureLabels.sort((a, b) =>
  a.page - b.page || Math.round(a.yMin) - Math.round(b.yMin) || a.xMin - b.xMin
);
const measures = measureLabels.map((lbl, idx) => ({
  idx, page: lbl.page, rowY: lbl.yMin, leftX: lbl.xMin, text: lbl.text,
}));

// Bound content to the staff: from above the first measure row to ~90px below
// the last row, dropping the running header and footer. The section label
// ("Part A") and tempo ("= 40") sit ~15-35px above the first row, so the top
// margin reaches up far enough to include them while still excluding the
// title/byline (~100px+ above the first row).
const TOP_MARGIN = 45;
const BOTTOM_MARGIN = 90;
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

// Rows + per-measure cell width (measures are ~uniform; last of a row inherits
// the median gap).
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
const medianGap = rowGaps.length ? rowGaps[Math.floor(rowGaps.length / 2)] : 260;
measures.forEach(m => {
  const row = measuresByPageRow.get(`${m.page}|${m.rowY}`);
  const i = row.indexOf(m);
  const width = i < row.length - 1 ? row[i + 1].leftX - m.leftX : medianGap;
  m.cellWidth = width / 16;
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
// Step 3: assign notes to (measure, step, hand, voice).
// ---------------------------------------------------------------------------
// Notes are the ~14px glyphs. Section words (~15px) and everything shorter
// (labels, annotations at ~11-12px) are excluded by the height window.
const noteWords = contentWords.filter(w => w.h >= 13 && w.h < SECTION_H);
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

// Valid voices for a D Kurd 9+1: ding (D), ding-shoulder (d), the app's
// percussion strokes (t/s/g), and tone fields 1-9.
const STROKE = { D: 'D', d: 'd', t: 't', s: 's', g: 'g' };

for (const { note, m, raw } of placed) {
  const corrected = raw - PHASE;
  const stepRaw = Math.round(corrected);
  const step = Math.min(15, Math.max(0, stepRaw));
  maxRoundingError = Math.max(maxRoundingError, Math.abs(corrected - stepRaw));
  const globalStep = m.idx * 16 + step;

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
// Step 4: sections (Part A / Part B) and tempo.
// ---------------------------------------------------------------------------
const marks = {};

// Section: "Part" (taller label) followed closely by a single-letter code.
const partWords = contentWords.filter(w => w.text === 'Part' && w.h >= SECTION_H);
for (const part of partWords) {
  const code = contentWords.find(w =>
    w.page === part.page && /^[A-Z0-9]+$/.test(w.text) && w !== part &&
    Math.abs(w.yMin - part.yMin) < 4 && w.xMin > part.xMax && w.xMin - part.xMax < 30);
  if (!code) continue;
  const m = findMeasureForLabelAbove(part.page, part.yMin, part.xMin);
  if (!m) continue;
  marks[m.idx] = marks[m.idx] || {};
  marks[m.idx].section = `Part ${code.text}`;
}

// Tempo: "=" followed closely by a number (the ♩=N marking). Only the opening
// tempo exists here; take the first such pair.
let tempo = 40; // fallback matching the PDF's marking
const eq = contentWords.find(w => w.text === '=');
if (eq) {
  const num = contentWords.find(w =>
    w.page === eq.page && /^\d+$/.test(w.text) &&
    Math.abs(w.yMin - eq.yMin) < 4 && w.xMin > eq.xMax && w.xMin - eq.xMax < 20);
  if (num) tempo = +num.text;
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
// Emit scripts/amy.json
// ---------------------------------------------------------------------------
const pattern = {
  name: 'Handpanuary 2025 Day 1 Relax + Flow',
  artist: 'Amy Naylor',
  instrument,
  tempo,
  beats: 4,
  sub: 4,
  measures: MEASURE_COUNT,
  marks,
  grid,
  v: 3,
};
writeFileSync('scripts/amy.json', JSON.stringify(pattern, null, 2) + '\n');

// ---------------------------------------------------------------------------
// Step 5: self-checks.
// ---------------------------------------------------------------------------
console.log('measures:', measures.length);
console.log('median measure gap:', medianGap.toFixed(1));
console.log('phase:', PHASE.toFixed(3));
console.log('unknown:', JSON.stringify(unknown));
console.log('collisions:', JSON.stringify(collisions));
console.log('max rounding error:', maxRoundingError.toFixed(4));
console.log('grid steps filled:', Object.keys(grid).length);
console.log('global tempo:', tempo);
console.log('marks:', JSON.stringify(marks));
console.log('wrote scripts/amy.json');
