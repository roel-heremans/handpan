#!/usr/bin/env node
// Dev-only offline parser: reconstructs "Sunrise" (Clara Sophia) from its PDF
// notation (pages 2-4) into scripts/sunrise.json, in the app's saved-pattern
// shape. NOT part of resonote.html - run manually with `node scripts/parse-sunrise.mjs`.
'use strict';

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PDF = 'assets/patterns/Sunrise - Clara Sophia.pdf';
const CENTER_OFFSET = 40;
const MEASURE_COUNT = 29;
// 5/4 time: 5 beats x 4 sixteenths = 20 subdivision columns per measure. (A
// straight 16-step grid mis-fits the notes; 20 lands them with ~0 error.)
const BEATS = 5, SUB = 4, SPM = BEATS * SUB;
const MLABEL_H = 12;   // measure numbers < this; notes ~19px, sections ~14-15px
const NOTE_H_LO = 17;  // note glyphs are >= this

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
// Step 2: find the 29 measures. Tempo values (50/70/76/78) are also short
// integers, but all exceed the measure count, so a <=29 cap excludes them.
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

// Rows + per-measure cell width (measures vary: 2-3 per row).
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
const medianGap = rowGaps.length ? rowGaps[Math.floor(rowGaps.length / 2)] : 391;
measures.forEach(m => {
  const row = measuresByPageRow.get(`${m.page}|${m.rowY}`);
  const i = row.indexOf(m);
  // Rows hold 2 or 3 measures (so their widths differ). Use the gap to the next
  // measure; the last of a row inherits its own row's spacing (the previous gap)
  // rather than the global median, which would over-widen 3-per-row measures.
  m.width = i < row.length - 1 ? row[i + 1].leftX - m.leftX
    : (row.length > 1 ? m.leftX - row[i - 1].leftX : medianGap);
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
// Step 3: detect each measure's meter, then assign notes to (step, hand, voice).
// The piece mixes 5/4 (20-step, Intro/Outro) and 4/4 (16-step, Main groove)
// measures. Each measure is stored in a SPM(=20)-cell slot; a 16-step measure
// fills steps 0-15 and leaves the last beat (16-19) empty, so one uniform grid
// holds the whole song with every note kept at its true in-measure position.
// ---------------------------------------------------------------------------
const noteWords = contentWords.filter(w => w.h >= NOTE_H_LO);
const byMeasure = new Map();
for (const note of noteWords) {
  const m = findMeasureForPoint(note.page, note.yMin, note.cx);
  if (!m) continue;
  if (!byMeasure.has(m.idx)) byMeasure.set(m.idx, []);
  byMeasure.get(m.idx).push(note);
}

const frac = x => ((x % 1) + 1) % 1;
const NCANDS = [12, 16, 20, 24];
function fitError(notes, m, N, phase) {
  let e = 0;
  for (const n of notes) { const s = (n.cx - m.leftX) / (m.width / N) - phase; e += Math.abs(s - Math.round(s)); }
  return e / notes.length;
}
measures.forEach(m => {
  const notes = byMeasure.get(m.idx) || [];
  if (notes.length < 2) { m.stepCount = 20; return; }   // sparse -> Intro/Outro meter
  let best = null;
  for (const N of NCANDS) {
    const fr = notes.map(n => frac((n.cx - m.leftX) / (m.width / N))).sort((a, b) => a - b);
    const ph = fr[Math.floor(fr.length / 2)];
    const e = fitError(notes, m, N, ph);
    if (!best || e < best.e) best = { N, e };
  }
  m.stepCount = best.N;
});

// One phase per meter group (more stable than a per-measure phase for sparse bars).
function groupPhase(N) {
  const fr = [];
  measures.filter(m => m.stepCount === N).forEach(m =>
    (byMeasure.get(m.idx) || []).forEach(n => fr.push(frac((n.cx - m.leftX) / (m.width / N)))));
  fr.sort((a, b) => a - b);
  return fr.length ? fr[Math.floor(fr.length / 2)] : 0;
}
const PHASE_BY_N = {};
NCANDS.forEach(N => { PHASE_BY_N[N] = groupPhase(N); });

const grid = {};
const unknown = [];
const collisions = [];
let maxRoundingError = 0;
const STROKE = { D: 'D', d: 'd', t: 't', s: 's', g: 'g' };

measures.forEach(m => {
  const N = m.stepCount, ph = PHASE_BY_N[N] || 0, cw = m.width / N;
  for (const note of (byMeasure.get(m.idx) || [])) {
    const corrected = (note.cx - m.leftX) / cw - ph;
    const stepRaw = Math.round(corrected);
    const step = Math.min(N - 1, Math.max(0, stepRaw));
    maxRoundingError = Math.max(maxRoundingError, Math.abs(corrected - stepRaw));
    const globalStep = m.idx * SPM + step;   // SPM(20)-cell slot; shorter measures pad the tail

    const hand = note.cy > (m.rowY + CENTER_OFFSET) ? 'L' : 'R';
    const token = note.text;
    const voice = STROKE[token] || (/^[1-8]$/.test(token) ? token : null);
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
});

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

// Sections: names (Intro/Main/Outro) and part labels (A1/A2/B1..C2), ~14-15px.
// The bare group letters A/B/C and the footer "C" (~13.8px) are ignored.
const SEC_NAME = new Set(['Intro', 'Main', 'Outro']);
const secWords = contentWords.filter(w =>
  w.h >= 13.5 && w.h < NOTE_H_LO && (SEC_NAME.has(w.text) || /^[A-C][1-3]$/.test(w.text)));
const secByMeasure = {};
for (const w of secWords) {
  const m = findMeasureForLabelAbove(w.page, w.yMin, w.xMin);
  if (!m) continue;
  (secByMeasure[m.idx] = secByMeasure[m.idx] || []).push(w.text);
}
for (const idx in secByMeasure) {
  const labs = [...new Set(secByMeasure[idx])]
    .sort((a, b) => (SEC_NAME.has(a) ? 0 : 1) - (SEC_NAME.has(b) ? 0 : 1));
  marks[idx] = marks[idx] || {};
  marks[idx].section = labs.join(' · ');
}

// Tempo: every "= N". First sets the global tempo; the rest are per-measure.
const eqWords = words.filter(w => w.text === '=');
const tempoEvents = [];
for (const eq of eqWords) {
  const num = words.find(w =>
    w.page === eq.page && /^\d+$/.test(w.text) &&
    Math.abs(w.yMin - eq.yMin) < 4 && w.xMin > eq.xMax && w.xMin - eq.xMax < 25);
  if (num) tempoEvents.push({ page: eq.page, yMin: eq.yMin, xMin: eq.xMin, value: +num.text });
}
tempoEvents.sort((a, b) => a.page - b.page || a.yMin - b.yMin || a.xMin - b.xMin);
let tempo = 76;
tempoEvents.forEach((ev, i) => {
  if (i === 0) tempo = ev.value;
  else addMark(ev.page, ev.yMin, ev.xMin, { tempo: ev.value });
});

for (const w of contentWords.filter(w => w.text === 'rall.')) {
  addMark(w.page, w.yMin, w.xMin, { expr: 'rall.' });
}

// ---------------------------------------------------------------------------
// Instrument (from PDF page 1: "C Kurd 9").
// ---------------------------------------------------------------------------
const instrument = {
  name: 'C Kurd 9', ding: 'C3', fields: [
    { note: 'G3', bottom: false }, { note: 'G#3', bottom: false }, { note: 'Bb3', bottom: false },
    { note: 'C4', bottom: false }, { note: 'D4', bottom: false }, { note: 'D#4', bottom: false },
    { note: 'F4', bottom: false }, { note: 'G4', bottom: false },
  ],
};

// ---------------------------------------------------------------------------
// Emit scripts/sunrise.json
// ---------------------------------------------------------------------------
const pattern = {
  name: 'Sunrise',
  artist: 'Clara Sophia',
  instrument,
  tempo,
  beats: BEATS,
  sub: SUB,
  measures: MEASURE_COUNT,
  marks,
  grid,
  v: 3,
};
writeFileSync('scripts/sunrise.json', JSON.stringify(pattern, null, 2) + '\n');

// ---------------------------------------------------------------------------
// Step 5: self-checks.
// ---------------------------------------------------------------------------
console.log('measures:', MEASURE_COUNT, '| slot steps/measure:', SPM);
const meterCounts = {};
measures.forEach(m => { meterCounts[m.stepCount] = (meterCounts[m.stepCount] || 0) + 1; });
console.log('per-measure meters (stepCount -> #measures):', JSON.stringify(meterCounts));
console.log('16-step (4/4) measures:', measures.filter(m => m.stepCount === 16).map(m => m.idx + 1).join(','));
console.log('phase by N:', JSON.stringify(PHASE_BY_N));
console.log('unknown:', JSON.stringify(unknown));
console.log('collisions:', JSON.stringify(collisions));
console.log('max rounding error:', maxRoundingError.toFixed(4));
console.log('grid steps filled:', Object.keys(grid).length);
console.log('tempo:', tempo, '| events:', JSON.stringify(tempoEvents.map(e => e.value)));
console.log('marks:', JSON.stringify(marks));
console.log('wrote scripts/sunrise.json');
