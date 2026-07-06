#!/usr/bin/env node
// Dev-only offline parser: reconstructs "He's a Pirate" (Pirates of the
// Caribbean, Zimmer/Badelt) from its PDF notation (pages 2-4) into
// scripts/pirate.json, in the app's saved-pattern shape.
// NOT part of resonote.html - run manually with `node scripts/parse-pirate.mjs`.
'use strict';

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PDF = "assets/patterns/He's A Pirate (Pirates Of The Caribbean) - Hans Zimmer.pdf";
const CENTER_OFFSET = 40;
const MEASURE_COUNT = 88;
// 3/4 time: 3 beats x 2 eighths = 6 subdivision columns per measure (the bass
// falls on steps 0/2/4, melody/pickups on the odd steps).
const BEATS = 3, SUB = 2, SPM = BEATS * SUB;
// This template's glyph heights: measure numbers ~11px, section labels ~14-15px,
// note tokens ~19px (bigger than the other songs' ~14px sheets).
const MLABEL_H = 12;      // measure numbers are below this
const NOTE_H_LO = 17;     // note glyphs are >= this (well above labels/sections)

// ---------------------------------------------------------------------------
// Step 1: extract PDF text boxes for the notation pages (2-4).
// ---------------------------------------------------------------------------
const xml = execFileSync('pdftotext', ['-f', '2', '-l', '4', '-bbox', PDF, '-']).toString();
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
// Step 2: find the 88 measures (short ~11px numeric labels).
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

// Bound content to the staff. Section labels ("Intro", "Theme n") sit ~35-40px
// above the first row, so the top margin reaches up for them while excluding the
// title/byline (~100px+ above) and the footer.
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

// Rows + per-measure cell width (measures ~uniform ~98px; last of a row inherits
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
// Step 3: assign notes to (measure, step, hand, voice).
// ---------------------------------------------------------------------------
const noteWords = contentWords.filter(w => w.h >= NOTE_H_LO);
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

// Valid voices for a D Kurd 9+1: ding (D), ding-shoulder (d), tone fields 1-9,
// plus a "T" tak stroke (mapped to the app's tak percussion, 't').
const STROKE = { D: 'D', d: 'd', t: 't', s: 's', g: 'g', T: 't' };

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
// Step 4: sections (Intro, Theme n, Theme n (bis)) and tempo.
// ---------------------------------------------------------------------------
const marks = {};
const secLabel = contentWords.filter(w => w.h >= 13 && w.h < NOTE_H_LO); // ~14-15px

function attachSection(page, y, x, label) {
  const m = findMeasureForLabelAbove(page, y, x);
  if (!m) return;
  marks[m.idx] = marks[m.idx] || {};
  marks[m.idx].section = label;
}

secLabel.filter(w => w.text === 'Intro').forEach(w => attachSection(w.page, w.yMin, w.xMin, 'Intro'));
secLabel.filter(w => w.text === 'Theme').forEach(theme => {
  const num = secLabel.find(w =>
    /^\d+$/.test(w.text) && w.page === theme.page &&
    Math.abs(w.yMin - theme.yMin) < 4 && w.xMin > theme.xMax && w.xMin - theme.xMax < 40);
  if (!num) return;
  const bis = secLabel.find(w =>
    w.text === '(bis)' && w.page === theme.page &&
    Math.abs(w.yMin - theme.yMin) < 4 && w.xMin > num.xMax && w.xMin - num.xMax < 40);
  attachSection(theme.page, theme.yMin, theme.xMin, `Theme ${num.text}${bis ? ' (bis)' : ''}`);
});

// Tempo: "=" followed closely by a number (the ♩=N marking).
let tempo = 170;
const eq = contentWords.find(w => w.text === '=');
if (eq) {
  const num = contentWords.find(w =>
    w.page === eq.page && /^\d+$/.test(w.text) &&
    Math.abs(w.yMin - eq.yMin) < 4 && w.xMin > eq.xMax && w.xMin - eq.xMax < 25);
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
// Emit scripts/pirate.json
// ---------------------------------------------------------------------------
const pattern = {
  name: "He's a Pirate",
  artist: 'Hans Zimmer & Klaus Badelt',
  instrument,
  tempo,
  beats: BEATS,
  sub: SUB,
  measures: MEASURE_COUNT,
  marks,
  grid,
  v: 3,
};
writeFileSync('scripts/pirate.json', JSON.stringify(pattern, null, 2) + '\n');

// ---------------------------------------------------------------------------
// Step 5: self-checks.
// ---------------------------------------------------------------------------
console.log('measures:', measures.length, '| steps/measure:', SPM);
console.log('median measure gap:', medianGap.toFixed(1));
console.log('phase:', PHASE.toFixed(3));
console.log('unknown:', JSON.stringify(unknown));
console.log('collisions:', JSON.stringify(collisions));
console.log('max rounding error:', maxRoundingError.toFixed(4));
console.log('grid steps filled:', Object.keys(grid).length);
console.log('global tempo:', tempo);
console.log('marks:', JSON.stringify(marks));
console.log('wrote scripts/pirate.json');
