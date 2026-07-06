# Default Song "Faded" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load "Faded" (Alan Walker) — transcribed from its PDF by an offline parser — as the default pattern shown when the app opens.

**Architecture:** A dev-only Node parser reads `pdftotext -bbox` output of the Faded PDF and reconstructs the pattern (instrument, grid, marks) into `scripts/faded.json`; that object is embedded as a `FADED` literal in `resonote.html` and loaded as the initial state on open. Accuracy is guaranteed by a render-and-diff loop against the source PDF.

**Tech Stack:** Single-file `resonote.html`; a Node ESM parser script under `scripts/`; `pdftotext` (poppler, installed) for text+coordinate extraction. Headless verification via `google-chrome` + `puppeteer-core`.

## Global Constraints

- The app stays a single file `resonote.html`; the parser is a separate dev script (`scripts/parse-faded.mjs`) NOT loaded by the app.
- Source: `assets/patterns/Faded (Panoramicsounds Version) - Alan Walker.pdf` (notation on pages 2–3).
- Instrument `DKurd 13 Opsilon`: ding `D3`; fields 1..10 = A3,Bb3,C4,D4,E4,F4,G4,A4,C5,D5 (top); 11 = F3, 12 = G3 (`bottom:true`).
- Grid `beats=4`, `sub=4` (16 cells/measure), `measures=25`. Right hand (above centerline) → `'R'`, left (below) → `'L'`.
- Voice tokens: `D`→ding; `1`–`12`→field; **`K`→`S`** (Knock → Slap); any other token is logged, not silently dropped.
- Title `Faded`; artist `Alan Walker (PANoramicSounds Version)`; starting tempo `90`; final tempo change `50` + `rall.` near the end; section labels `Part 1A/1B/2A/2B/3`.
- Faded is the default INIT state (replaces the demo grid); NOT seeded into Saved patterns.
- Verification: `node --check` on the parser; the parser's structural self-checks; and (Task 3) a headless render-and-diff of the app's notation against the PDF, plus regression checks.

---

### Task 1: Offline parser → `scripts/faded.json`

**Files:**
- Create: `scripts/parse-faded.mjs`, `scripts/faded.json` (generated output, committed).

**Interfaces:**
- Produces: `scripts/faded.json` — a pattern object `{name, artist, instrument, tempo, beats, sub, measures, marks, grid, v:3}` in the app's saved-pattern shape.

- [ ] **Step 1: Extract the PDF text boxes**

The parser shells out to `pdftotext`:

```js
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const PDF = 'assets/patterns/Faded (Panoramicsounds Version) - Alan Walker.pdf';
const xml = execFileSync('pdftotext', ['-f','2','-l','3','-bbox', PDF, '-']).toString();
// each word: <word xMin=".." yMin=".." xMax=".." yMax="..">TEXT</word>, grouped under <page>
```

Parse the XML into records `{page, text, xMin, yMin, xMax, yMax, w:xMax-xMin, h:yMax-yMin, cx:(xMin+xMax)/2, cy:(yMin+yMax)/2}` (one per `<word>`), tracking which `<page>` each belongs to (split the XML on `<page`).

- [ ] **Step 2: Classify words and find measures**

- **Notes vs labels by font height:** note glyphs are ~13.9px tall; measure/section/tempo labels are ~10.6–11.9px. Treat `h >= 13` as a **note**, `h < 13` as a **label**.
- **Measure labels:** labels whose text is an integer in `1..25`. Sort measures by `(page, round(yMin), xMin)`; assign them measure indices `0..24` in that order (there should be exactly 25). Each measure records `{idx, page, rowY:yMin, leftX:xMin}`.
- **Cell width:** for each pair of measures on the same row (same `page` and `|rowY diff| < 5`), `width = next.leftX - this.leftX`; `cellWidth = median(widths)/16`. (Measures are uniform width; the last measure in a row reuses this width.)
- **Centerline per measure:** `centerlineY = measure.rowY + 40` (calibrated; a note is left-hand if `cy > centerlineY`, else right-hand). This offset is a tunable constant `CENTER_OFFSET=40` — Task 3 confirms/adjusts it against the PDF.

- [ ] **Step 3: Assign notes to (measure, step, hand, voice)**

For each note word:
- Find its measure: the measure on the same row (`same page`, `|rowY - (note.yMin-40)|`… simplest: the measure `m` with the same `page` and largest `leftX <= note.xMin` among measures whose `rowY` is ~`note`'s row) — i.e. match by row then by `leftX <= note.cx < nextLeftX`.
- `step = clamp(round((note.cx - m.leftX)/cellWidth), 0, 15)`; `globalStep = m.idx*16 + step`.
- `hand = note.cy > (m.rowY + CENTER_OFFSET) ? 'L' : 'R'`.
- `voice = token==='D' ? 'D' : token==='K' ? 'S' : (/^([1-9]|1[0-2])$/.test(token) ? token : null)`. If `null`, push to an `unknown` list and skip.
- Set `grid[globalStep] = grid[globalStep] || {}; grid[globalStep][voice] = hand;`

Track the max `|(note.cx - m.leftX)/cellWidth - step|` (rounding error) across all notes — a large value (>0.3) signals a subdivision mismatch (e.g. triplets); log it.

- [ ] **Step 4: Sections, tempo, expression, instrument**

- **Sections:** label words forming `Part 1A/1B/2A/2B/3` (join adjacent `Part`+`code` labels by proximity) → attach to the measure at that row's left: `marks[m.idx].section = 'Part 1A'` etc.
- **Tempo:** the first `= N` (a `=` label followed by a number) → `tempo = 90`. A later `= 50` near the end → `marks[m.idx].tempo = 50` for the measure at its row/x. `rall.` label → `marks[m.idx].expr = 'rall.'` for its measure.
- **Instrument (hard-coded, from page 1):**

```js
const instrument = { name:'DKurd 13 Opsilon', ding:'D3', fields:[
  {note:'A3',bottom:false},{note:'Bb3',bottom:false},{note:'C4',bottom:false},
  {note:'D4',bottom:false},{note:'E4',bottom:false},{note:'F4',bottom:false},
  {note:'G4',bottom:false},{note:'A4',bottom:false},{note:'C5',bottom:false},
  {note:'D5',bottom:false},{note:'F3',bottom:true},{note:'G3',bottom:true}]};
```

- **Emit:** write `scripts/faded.json` =
  `{name:'Faded', artist:'Alan Walker (PANoramicSounds Version)', instrument, tempo:90, beats:4, sub:4, measures:25, marks, grid, v:3}`
  (pretty-printed).

- [ ] **Step 5: Self-checks + run**

At the end the script logs: measure count (expect `25`), `unknown` tokens (expect `[]` after K→S), the max rounding error, the number of grid steps filled, and measure-1's R and L note lists. Run it:

```bash
cd /home/roel/Documents/PersonalRepos/handpan && node scripts/parse-faded.mjs
```

Expected: `measures: 25`, `unknown: []`, max rounding error small (< ~0.3), and measure-1 R includes `D`,`1` with L including `6` (matching the PDF page-2 measure 1). Also `node --check scripts/parse-faded.mjs`.

- [ ] **Step 6: Commit**

```bash
git add scripts/parse-faded.mjs scripts/faded.json
git commit -m "feat: offline parser generating the Faded pattern from its PDF"
```

---

### Task 2: Embed `FADED` + load it on open

**Files:**
- Modify: `resonote.html` — add the `FADED` constant; replace the INIT demo grid/instrument with loading `FADED`.

**Interfaces:**
- Consumes: `scripts/faded.json` (Task 1); the existing `state` shape, `renderPresetOptions`, `syncControls`, `renderAll`, `refreshLibrary`, `checkStorage`, `renderSampVoices`, `updateSampBar`, `loadSamples`.

- [ ] **Step 1: Embed the pattern**

Paste the contents of `scripts/faded.json` as a JS object literal assigned to `const FADED = { … };`, placed just after the `PRESETS`/`state` definitions (near the top of the main script). (Copy the JSON verbatim; JSON is valid JS.)

- [ ] **Step 2: Load FADED as the initial state**

The current INIT block is:

```js
state.grid={0:{'D':'R'},3:{'S':'L'},4:{'3':'R'},6:{'5':'L'},8:{'D':'R'},11:{'S':'L'},12:{'6':'R'},14:{'4':'L'}};
renderPresetOptions();syncControls();renderAll();refreshLibrary();checkStorage();
renderSampVoices();updateSampBar();loadSamples();
```

Replace the demo-grid line and initialize from FADED (mirroring `loadPattern`'s field-coercion), and set the name/artist inputs:

```js
state.instrument=JSON.parse(JSON.stringify(FADED.instrument));
state.instrument.fields=state.instrument.fields.map(f=>typeof f==='string'?{note:f,bottom:false}:f);
state.artist=FADED.artist||''; state.tempo=FADED.tempo; state.beats=FADED.beats; state.sub=FADED.sub; state.measures=FADED.measures;
state.marks=FADED.marks?JSON.parse(JSON.stringify(FADED.marks)):{};
state.grid=JSON.parse(JSON.stringify(FADED.grid));
renderPresetOptions();syncControls();renderAll();refreshLibrary();checkStorage();
renderSampVoices();updateSampBar();loadSamples();
const _pn=document.getElementById('patName'); if(_pn)_pn.value=FADED.name||'';
const _ai=document.getElementById('artistInput'); if(_ai)_ai.value=state.artist;
```

- [ ] **Step 3: Verify**

`node --check` on the extracted main `<script>`. Then headless (puppeteer-core from the scratchpad dir): load `http://localhost:8001/resonote.html` and assert the app opened on Faded:

```js
const r=await page.evaluate(()=>({title:document.getElementById('patName').value, artist:state.artist,
  instr:state.instrument.name, measures:state.measures, beats:state.beats, sub:state.sub,
  steps:Object.keys(state.grid).length, bottom:state.instrument.fields.filter(f=>f.bottom).map(f=>f.note)}));
console.log(r);
// expect: title 'Faded'; artist starts 'Alan Walker'; instr 'DKurd 13 Opsilon'; measures 25; beats 4; sub 4; steps > 0; bottom ['F3','G3']
```

Report that visual accuracy vs. the PDF is verified by the controller in Task 3.

- [ ] **Step 4: Commit**

```bash
git add resonote.html
git commit -m "feat: load Faded as the default pattern on open"
```

---

### Task 3: Accuracy verification + iteration (controller-driven, headless)

**Files:**
- Modify: `scripts/parse-faded.mjs` / `scripts/faded.json` / `resonote.html` — only as needed to fix transcription errors found by the visual diff.

**Interfaces:** none new.

- [ ] **Step 1: Render Faded's notation from the app**

Drive the app in headless Chrome: it already opens on Faded; open the printable/perform notation (or generate the PDF) and capture the notation for all measures.

- [ ] **Step 2: Diff against the source PDF**

Compare the app's rendered notation, measure by measure, against `assets/patterns/Faded (Panoramicsounds Version) - Alan Walker.pdf` pages 2–3: same numbers, same hand (orange-above / blue-below), same step positions, section labels (`Part 1A…`), tempo marks (`♩=90`, `♩=50`, `rall.`), and the K→S (`s`) in measure 8.

- [ ] **Step 3: Fix any mismatches**

For discrepancies (wrong hand → adjust `CENTER_OFFSET`; wrong step → adjust cell-width/rounding; missing/extra notes; large rounding error signalling a subdivision mismatch), fix `parse-faded.mjs`, re-run it to regenerate `scripts/faded.json`, re-embed the updated `FADED` into `resonote.html`, and re-render until it matches the PDF.

- [ ] **Step 4: Regression + open check**

Confirm: opening the app shows Faded (title/artist, D Kurd 13 pan with F3/G3 underside, 25 measures, sections + tempo); playback and the perform view work on it; saving/loading a pattern, PDF export, and the ⏮/⏭/scrub controls still work. Screenshot the app on open.

- [ ] **Step 5: Commit**

```bash
git add scripts/parse-faded.mjs scripts/faded.json resonote.html
git commit -m "chore: verify + correct the Faded transcription against the source PDF"
```

---

## Self-review notes

- **Spec coverage:** offline parser + generated data (Task 1); embed + default-load-on-open (Task 2); render-and-diff accuracy gate + regression (Task 3). Instrument, grid geometry (measures/hand/step), voice mapping (incl. K→S), sections/tempo, and the "not seeded into Saved patterns" decision are all covered. All spec sections mapped.
- **Placeholder scan:** the parser algorithm and the embed code are concrete; the grid data itself is produced by the parser (its output), not a placeholder. Verification steps give concrete commands + expected values.
- **Type consistency:** `scripts/faded.json` (Task 1) → `FADED` literal (Task 2) → INIT load; the object shape `{name, artist, instrument{name,ding,fields[{note,bottom}]}, tempo, beats, sub, measures, marks, grid, v}` matches `snapshot()`/`loadPattern()` used elsewhere in the app. `CENTER_OFFSET`, `cellWidth`, and the `grid[globalStep][voice]='R'|'L'` shape are consistent across Tasks 1 and 3.
```
