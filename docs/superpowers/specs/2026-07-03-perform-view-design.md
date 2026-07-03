# Performance View — Design

Date: 2026-07-03
Status: Approved (design), pending spec review

## Goal

Add a full-screen **performance view** to the Resonote handpan app. When entered,
it shows only two things — the handpan and the notation — and plays the pattern
back with:

- the handpan lighting up the notes as they sound at the current time, and
- the notation (in the app's Notepan/PDF staff style) **scrolling by**
  horizontally under a fixed "now" playhead.

Everything else (note-entry grid, instrument setup, sampler, saved patterns,
editor controls) is hidden.

## Decisions

- **Trigger:** a dedicated **▶ Perform** button in the transport. The normal
  Play button is unchanged (keeps in-editor play-along). Esc or an Exit control
  returns to the editor.
- **Scroll style:** continuous horizontal scroll — the whole piece is one long
  staff sliding right→left under a fixed vertical playhead line.
- **Layout:** the pan on top (large, lighting notes); the scrolling notation
  strip below.
- Presentation-only: no note entry or instrument setup in this view.

## Architecture (Approach A — reuse engine + playback)

A new full-screen overlay `#performOverlay` (same pattern as the existing
`#printOverlay`), hidden by default, containing:

1. **Performance pan** — the pan rendered large into the overlay, reusing the
   `renderPan()` layout logic. `litPan()` is generalized so playback lighting
   lights matching `[data-voice]` elements in **both** the editor pan and the
   performance pan.
2. **Notation strip** — the whole piece rendered as **one horizontal staff**
   (not wrapped into rows), reusing the shared engine: `buildScoreModel(state)`
   then `layoutScore(model, measures*MEASURE_W, /*perRow*/ measures)` and the
   existing `measureSVG()` for barlines, ticks, orange/blue numbers, and
   section/tempo/expression labels. The strip lives in a horizontally-clipped
   viewport with a fixed vertical **playhead** line.
3. **Minimal control bar** — Exit (✕), Play/Pause, and a tempo readout.

### Reuse and required changes
- **`layoutScore`** gains an optional `perRow` argument (defaults to
  `SCORE.measPerRow`) so the strip can request a single row of all measures.
  Existing callers are unaffected.
- **`litPan(v, hand)`** changes from `querySelector('#pan …')` to lighting all
  matching `[data-voice]` (editor pan + performance pan). Both pans carry the
  same `data-voice` attributes, so existing playback lighting works unchanged.
- **`play()` / `scheduler()` / `stop()`** are reused as-is for audio. A play
  anchor time (the audio-clock time of step 0) is captured so the scroll can be
  derived from the same clock the scheduler uses.

## Data flow — scrolling

- **Enter:** ▶ Perform → render performance pan + strip → show overlay → `play()`.
- **Animate:** a `requestAnimationFrame` loop computes the current playback
  position (in fractional steps) from the audio clock, maps it to an x on the
  strip (`x = position * (MEASURE_W / stepsPerMeasure)`), and sets the strip's
  `transform: translateX(playheadX − x)`. This keeps the playhead synced to what
  is heard. Notes crossing the playhead get a brief emphasis; the pan flashes
  them via the existing `litPan()`.
- **Loop:** follows the existing Loop setting; the position wraps modulo
  `totalSteps()` and the strip jumps back to the start at the loop point.
- **Exit:** Exit / ✕ / Esc → `stop()`, cancel the rAF loop, hide the overlay.

### Timing note
Playback runs at the single global `state.tempo` (per-measure tempo marks are
display-only and are not applied by the scheduler — unchanged behavior), so the
step→x mapping is uniform. The tempo control lives in the editor, which the
overlay fully covers, so tempo cannot change while performing — the anchor stays
valid for the duration of a performance.

## Components and boundaries

- `renderPerformPan()` — draw the large pan into the overlay (shares field
  ordering with `renderPan()`).
- `renderPerformStrip()` — build the single-row notation SVG via the shared
  engine; returns/sets the strip element and records its total width and the
  x-per-step scale.
- `performLoop()` — the rAF tick: compute position, translate the strip, emphasize
  notes at the playhead. Owns start/stop of the animation frame.
- `enterPerform()` / `exitPerform()` — show/hide the overlay and wire playback.

Each has one responsibility and communicates through the existing `state` and the
shared engine; none needs to know the others' internals.

## Testing / verification

Drive the real app in headless Chrome (as done for the PDF calibration):
- Open the performance view, start playback, and capture strip + pan screenshots
  at a few playback positions.
- Verify: only pan + notation are visible; the playhead is fixed while the strip
  scrolls right→left; the note(s) under the playhead are lit on the pan and
  emphasized on the strip; orange/blue hand coloring is preserved; Loop wraps;
  Exit/Esc restores the editor unchanged.

## Out of scope

- Editing, instrument setup, or sampler controls inside the performance view.
- Applying per-measure tempo changes during playback (display-only, unchanged).
- Countdown/metronome UI changes (existing metronome setting still applies).

## Risks

- **Scroll/audio sync** is the main risk; mitigated by deriving the scroll
  position from the same audio clock the scheduler uses and re-anchoring on tempo
  change.
- **Pan lighting across two pans** — mitigated by the small `litPan()`
  generalization; verified by the headless screenshots.
