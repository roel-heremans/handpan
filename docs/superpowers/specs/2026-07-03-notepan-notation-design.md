# Resonote → Notepan-style notation & theme — Design

Date: 2026-07-03
Status: Approved (design), pending spec review

## Goal

Make Resonote's exported PDF and on-screen appearance match the Notepan app,
using the reference PDFs in `assets/patterns/` as the exact visual target:

1. **PDF output** reproduces Notepan's two-page format (pan diagram page +
   horizontal-staff notation with orange right-hand / blue left-hand numbers,
   section labels, tempo marks, and a per-page footer).
2. **On-screen app** adopts Notepan's light aesthetic, and hand colors become
   **orange = right hand, blue = left hand** everywhere.
3. **Annotations** (artist, section/part labels, tempo changes, expression
   marks like `rall.`) become fully editable in the app.

Reference PDFs (ground truth for metrics and layout):
`assets/patterns/Happy Birthday - Popular.pdf`,
`assets/patterns/RoelsCollection.pdf` (multi-page).

## Reference format (observed from the PDFs)

### Page 1 — pan diagram
- Centered **title** (large) + **artist** subtitle (gray) at top.
- Soft **blue-gray filled circle**; **white note pods** around the rim, each
  showing the **note name in blue** on top and the **number in gray** below.
- Larger **center ding pod** (note name + `D`).
- **Scale name** (e.g. `D Kurd 9+1`) centered near the bottom.

### Pages 2+ — notation
- Each **measure** is a horizontal staff segment:
  - Thick **barline** at the left edge of the measure.
  - A horizontal **centerline** through the middle.
  - **Vertical ticks** at subdivisions; **beat ticks are taller**, subdivision
    ticks shorter.
  - **Measure number** small, top-left of the segment.
- Measures flow **left→right, ~5 per row**, multiple rows per page.
- **Right-hand notes → orange numbers above the centerline; left-hand notes →
  blue numbers below**, placed at the step's horizontal position. Simultaneous
  same-hand notes **stack** away from the centerline.
- **Section markers:** boxed labels (`Intro`, `Part A`, `Part B`, `Part C`) and
  centered subsection labels (`A - 1`, `A - 2`, `B - 1`, …). A measure may carry
  a boxed part label and/or a centered section label.
- **Tempo / expression:** `♩ = N` (e.g. `♩ = 170`), tempo changes mid-piece,
  and `rall.` rendered as italic text with a **dashed extension line**.
- **Footer** on every notation page: `Title - Artist | Scale    page/total`.

## Data model changes (saved-pattern version 2 → 3)

- Add `state.artist` (string, subtitle).
- Add `state.marks`: object keyed by measure index →
  `{ part?: string, section?: string, tempo?: number, expr?: string }`.
- `snapshot()` serializes `artist` + `marks`; `loadPattern()` restores them.
- **Backward compatibility:** v2 patterns still load — `artist` defaults to
  `""`, `marks` defaults to `{}`.
- The scale label already exists as `state.instrument.name`.
- The song title continues to come from the pattern-name field.

## Architecture — one shared layout engine (Approach A)

A single `layoutScore()` function consumes the grid + annotations and produces
**abstract draw-ops** (positioned lines, ticks, and numbers with color + role).
Two thin renderers consume the same ops so the screen preview and the PDF can
never diverge:

- `renderScoreSVG(ops)` → on-screen print-preview (replaces the old red/black
  `.print-sheet`).
- `renderScorePDF(ops, doc)` → jsPDF drawing (replaces `buildPDF`'s stacked
  columns).

Metrics (measure width, tick heights, number font size, exact orange/blue/gray
hex, barline weight) are calibrated against the reference PDFs and defined once
as constants used by both renderers.

### Grid → notation mapping
Resonote's grid already carries everything: `state.grid[step][voice] = 'R'|'L'`.
For each measure, for each step, collect `R` voices (→ orange, above) and `L`
voices (→ blue, below); `printSym(voice)` already yields the displayed symbol
(`D`, `1..n`, percussion letters). Horizontal x derives from the step's position
within the measure (`beats × sub`).

## PDF assembly

- **Page 1:** pan diagram as described (reuse the pan field-ordering logic from
  `renderPan()` but drawn light, via jsPDF primitives).
- **Pages 2+:** notation rows from `layoutScore()`, section boxes + centered
  labels, tempo/expression marks, and the footer. Paginate by remaining vertical
  space (start a new page when the next row won't fit), numbering `p/total`.
- Keep the existing HTML-print fallback (`downloadPrintHTML`) but regenerate it
  from the shared SVG renderer so it also matches.

## On-screen theme (light Notepan aesthetic)

- Redefine the CSS custom properties: paper/white background, blue-gray pan,
  ink-colored text, orange/blue hand accents. The existing markup and layout
  stay; this is primarily a palette swap plus contrast adjustments.
- The print-preview overlay renders the shared SVG score (light), replacing the
  current stacked red/black sheet.

## Hand colors — orange (right) / blue (left)

Apply the same orange/blue everywhere a hand is shown:
grid cells (`on-R`/`on-L`), pan lit-states (`lit`/`lit-L` and ding variants),
the text readout (`.lft` and right-hand default), the legend swatches, and the
sampler indicator. Exact orange/blue hex sampled from the reference PDFs.

## Annotation editor UI

A new **"Score details"** panel:
- **Artist** text field (subtitle).
- A compact **per-measure** control row (Part label, Section label, Tempo bpm,
  Expression text). Editing updates `state.marks` and re-renders the live
  notation preview; values flow straight into the PDF.

## Testing / verification

- Recreate the **"Happy Birthday"** grid + annotations from the reference and
  visually diff the generated PDF against
  `assets/patterns/Happy Birthday - Popular.pdf`.
- Verify: orange-above / blue-below placement and stacking, beat vs subdivision
  ticks, measure numbering, section boxes + centered labels, `♩ = N` and `rall.`
  dashed line, multi-page pagination, and the `Title - Artist | Scale  p/total`
  footer.
- Confirm on-screen orange/blue hands across pan, grid, readout, legend.
- Confirm v2 saved patterns still load without error.

## Out of scope (this iteration)

- Audio engine, sampler, and storage/persistence behavior (unchanged).
- Automatic transcription or beat-detection.
- Changing the note/percussion vocabulary.

## Risks

- **Pixel fidelity** of the notation is the main effort; mitigated by
  calibrating shared metric constants against the reference PDFs and diffing.
- Theme overhaul touches many styles; mitigated by centralizing on CSS
  variables and swapping values rather than rewriting rules.
