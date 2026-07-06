# Default Song: "Faded" — Design

Date: 2026-07-06
Status: Approved (design), pending spec review

## Goal

Load **"Faded" (Alan Walker, PANoramicSounds version)** as the default pattern
shown when the app opens, transcribed from
`assets/patterns/Faded (Panoramicsounds Version) - Alan Walker.pdf`.

Backlog item: "Adding the Alan Walker song as the default song to be loaded when
first opening the app."

## Decisions

- Load behavior: Faded is the **default pattern shown on open** (replaces the
  current small demo grid). Editing/clearing replaces it until the page reloads.
  (Not seeded into Saved patterns.)
- The PDF is **machine-readable**: `pdftotext -bbox` yields every number with its
  x/y box, so the song is reconstructed by an **offline parser** — not
  transcribed by eye.
- The Notepan **"K" (Knock)** symbol, which the app doesn't have, maps to the
  app's **Slap** percussion voice (`S`, label `s`).

## The pattern (target data)

- **Title** `Faded`; **artist** `Alan Walker (PANoramicSounds Version)`.
- **Instrument** name `DKurd 13 Opsilon`, ding `D3`, fields (1-indexed):
  1 A3, 2 Bb3, 3 C4, 4 D4, 5 E4, 6 F4, 7 G4, 8 A4, 9 C5, 10 D5 (top);
  11 F3, 12 G3 (`bottom:true`, underside).
- **Grid** `beats=4`, `sub=4` (sixteenths → 16 cells/measure), `measures=25`.
  Notes are quantized to the nearest cell; right hand (orange, above the
  centerline) → `'R'`, left hand (blue, below) → `'L'`.
- **Marks** (per measure index, 0-based): section labels `Part 1A`(m1),
  `Part 1B`(m5), `Part 2A`(m9), `Part 2B`(m13), `Part 3`(m17); starting tempo
  `♩=90`; the final tempo change `♩=50` and the `rall.` expression near the end
  (measures ~24–25), read from the PDF's tempo/expression labels.
- **Voices:** `D`→ding; `1`–`12`→tone fields; `K`→`S` (slap). Any other
  non-numeric token is flagged by the parser (not silently dropped).

## Architecture

Two clearly separated pieces:

### 1. Offline parser (`scripts/parse-faded.mjs`, dev-only — NOT shipped in the app)
Consumes `pdftotext -bbox` output for the notation pages and reconstructs the
pattern object:
- **Measures:** the small gray measure-number labels (`1`..`25`) give each
  measure's left x and its staff row; two measures per row. A measure spans from
  its label x to the next measure's label x (last measure to row end).
- **Hand:** within a staff row the numbers form two y-bands separated by the
  centerline; `yMin` below the split → left (`L`), above → right (`R`).
- **Step:** cell width = the finest consistent x-gap between columns in a
  measure; `step = measureBase + round((x - measureLeft)/cellWidth)`, clamped to
  the measure's `beats*sub` cells.
- **Voice:** the token → `D`/`1..12`/`S` (from `K`); unknown tokens logged.
- **Sections / tempo / rall.:** from the `Part …`, `♩ = N`, and `rall.` text.
- Emits a pattern object: `{name, artist, instrument, tempo, beats, sub,
  measures, marks, grid}` (the app's saved-pattern shape) and writes it to a
  file for inspection.

### 2. App change (`resonote.html`)
- Add a `const FADED = { … }` pattern object (the parser's output, embedded as a
  JS literal) near the app's presets/state.
- In the INIT block, replace the current demo grid + instrument setup with
  loading `FADED` as the initial state (instrument, tempo, beats, sub, measures,
  marks, grid, title into `#patName`, artist into `state.artist`), then render.
  Reuse the existing `loadPattern`-style assignment so the shapes match.

## Data flow

PDF → `pdftotext -bbox` → `parse-faded.mjs` → `FADED` pattern object → embedded in
`resonote.html` INIT → app opens showing Faded.

## Verification

- **Parser sanity:** the parser logs measure count (25), any unknown tokens
  (expect none after `K`→`S`), and per-section spot-checks (e.g. measure 1 R:
  `D`,`1`… L: `6`…).
- **Round-trip visual diff (the accuracy gate):** load `FADED` in the app
  (headless), open the printable/perform notation, and compare page-by-page
  against the original `Faded … .pdf` pages 2–3 (same numbers, hands, positions,
  section labels, tempo marks). Iterate the parser until they match.
- **App open:** loading the app shows Faded — title/artist, the D Kurd 13 pan
  (with 11/12 underside), 25 measures, sections and tempo marks; playback and the
  perform view work on it.
- **No regressions:** saved-pattern load/save, PDF export, and the perform view
  still work (Faded is just the initial state).

## Out of scope

- Seeding Faded into the Saved-patterns library.
- A general in-app PDF importer (the parser is an offline dev script).
- Adding a real "Knock" percussion voice (K is mapped to Slap).

## Risks

- **Subdivision fit:** the whole song must fit a sixteenth grid (`sub=4`). If a
  section turns out to be triplets, one global `sub` can't represent both — the
  parser will flag non-power-of-two spacing so it's caught, not silently
  mis-quantized.
- **Transcription accuracy:** mitigated by the render-and-diff verification loop
  against the source PDF.
- **File size:** the embedded `FADED` grid adds ~a few hundred lines to
  `resonote.html`; acceptable for a single-file app and a default song.
