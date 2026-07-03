# Performance View — 3-Measure Window + PDF-Style Lines — Design

Date: 2026-07-04
Status: Approved (design), pending spec review

## Goal

Refine the performance-view notation strip so that:

1. Only about **three measures** are visible at once — the previous, the
   current, and the next — via continuous smooth scroll (unchanged motion) with
   a **centered** playhead and wider measures.
2. The notation reads like the reference PDFs in `assets/patterns/`: a **bold
   black barline** at each measure start, a **taller black line every 4 cells**
   (each beat), short subdivision ticks between, and note numbers centered on
   their cell (orange above / blue below).
3. The **◀ rewind** button jumps back one whole measure per press (twice → two
   measures back).

A "tack" (the user's term) = one measure = beats×sub cells (e.g. 4×4 = 16),
with a taller line after every `sub` cells (a beat) and a bold barline after the
full measure.

## Decisions

- Motion stays **continuous scroll** (not paged); only the framing changes.
- Playhead moves to the horizontal **center** of the stage.
- The PDF-style line treatment is applied to the **perform strip only** (the
  PDF/print export is unchanged).
- Rewind = previous measure boundary each press.

## Current state (what changes)

`renderPerformStrip()` currently uses a fixed `perform.measureW = 220`, a
playhead at 30% of the stage, and reuses `measureSVG()` (which draws all ticks in
gray `SCORE.tickGray` and the barline at `SCORE.barW`), with a perform-only
temporary `SCORE` override for the enlarged vertical metrics. `performRewind()`
currently targets the current measure's start (or previous if near the start).

## Changes

### 1. Three-measure framing
- Compute `MEASURE_W` from the stage width so ~3 measures fill it:
  `perform.measureW = Math.max(200, Math.round(stageWidth / 3))`, computed in
  `enterPerform` (stage is visible then) before `renderPerformStrip`.
- Playhead centered: `perform.playheadX = Math.round(stageWidth * 0.5)`.
- `renderPerformStrip` uses `perform.measureW` for `contentW`, and records
  `perform.stepW = measureW/spm` and `perform.stride = measureW + measGap` as
  today (the scroll math is unchanged — only `measureW` grew). The whole piece
  remains one continuous strip; the viewport frames three measures.

### 2. PDF-style black lines (perform strip only)
- Extend the existing perform-only `SCORE` override in `renderPerformStrip` to
  also darken the ticks and thicken the barline, matching the reference:
  `SCORE.tickGray` → near-black (e.g. `[40,40,40]`) and `SCORE.barW` → bolder
  (e.g. `3`), alongside the existing enlarged vertical metrics. `measureSVG`
  already draws taller ticks at beats (`SCORE.tickTall`) and shorter ticks at
  subdivisions (`SCORE.tickShort`) and a barline at each measure start, so this
  yields: bold black barline, taller black beat lines every `sub` cells, short
  darker subdivision ticks. All override values are restored in the existing
  `finally` block, so the PDF/print path is unaffected.
- Numbers remain centered on their cell (`layoutScore` places them at the cell
  center `x0 + k*colW + colW/2`), orange (R, above) / blue (L, below).

### 3. Rewind = previous measure
- `performRewind` computes the current measure `m = floor(pos/spm)` (using the
  frozen `pausedStep` when paused, per the existing fix), and always targets the
  **previous** boundary: `target = Math.max(0, m-1) * spm`, then `performSeek(target)`.
  From mid-measure `m`, one press → measure `m-1`; a second press (now at `m-1`)
  → `m-2`; i.e. two presses → two measures back.

## Testing / verification

Headless Chrome:
- `perform.measureW ≈ round(stageWidth/3)` (so ~3 measures span the stage); the
  playhead element is at ~50% of the stage width.
- The strip SVG contains a bold barline and taller beat lines; sample a couple of
  tick stroke colors to confirm they are the darkened perform value, and confirm
  the barline stroke width is the thickened perform value.
- Two ◀ presses from mid-piece land two measure-boundaries earlier than one press.
- Regression: a generated PDF still uses the original gray ticks / thin barline
  (SCORE restored) — i.e. the perform overrides did not leak into export.
- Screenshot the perform view and visually compare the line treatment against
  `assets/patterns/Happy Birthday - Popular.pdf` page 2.

## Out of scope

- Paged (non-scrolling) view.
- Changing the PDF/print export appearance.
- Any change to audio playback, pause/resume, speed presets, or count-in beyond
  the rewind granularity.

## Risks

- **Measure width vs readability**: `stageWidth/3` makes measures wide; note
  spacing grows but stays proportional. Calibrated against the reference by
  screenshot.
- **Line darkening leaking to PDF**: mitigated by keeping all overrides inside
  the existing try/finally `SCORE` save/restore in `renderPerformStrip`.
