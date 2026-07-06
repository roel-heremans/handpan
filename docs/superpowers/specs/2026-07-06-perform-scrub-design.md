# Performance View — Drag-to-Scrub the Notation — Design

Date: 2026-07-06
Status: Approved (design), pending spec review

## Goal

Let the user **slide the notation back and forth** in the performance view by
dragging directly on the notes (touch or mouse), in addition to the existing
⏮/⏭ measure-jump buttons. Natural on iPad: drag the strip under the fixed
playhead to scrub through the piece.

Backlog item: "Having a sliding option to go back and forth on the displayed
notes, additionally to the jump back and forward option."

## Decisions

- Interaction = **drag the notes directly** (no separate slider bar).
- Dragging **while playing pauses** playback first (same as the jump buttons).
- **Live** while dragging: the pan's held tone-field highlight follows the note
  under the playhead.
- On release, **snap to the nearest step**, stay **paused** (waiting) with the
  held notes shown; **Play** resumes with the count-in from that position.
- Silent scrub (no audio while dragging). Presentation-only; no separate slider.

## Current state (what this builds on)

The perform strip is one continuous SVG scrolled by a CSS `transform:translateX`.
- While playing, `performTick` (rAF) sets the transform each frame from the audio
  clock; the playhead is fixed at `perform.playheadX` (stage center).
- While paused, `performMoveStrip(step)` sets the transform so `step` sits under
  the playhead, using `x = mi*perform.stride + inM*perform.stepW` where
  `mi=floor(step/spm)`, `inM=step-mi*spm`, `spm=perform.spm`.
- `perform.pausedStep` holds the waiting position; `showPausedNotes(step)` shows
  the held tone-fields on `#performPan`; `stop()` freezes/cancels the rAF.
- `⏮`/`⏭` (`performSeekMeasure`) already set `pausedStep`, move the strip, and
  show held notes. Play (`performResume` → `countInThenPlay`) resumes with the
  count-in.

The scrubber plugs into this exact machinery: it just sets `pausedStep` + moves
the strip + shows held notes, leaving audio, count-in, and buttons untouched.

## Components (all in `resonote.html`, perform section)

### Forward mapping — extract `stepToX(step)`
The forward step→x math is currently inlined (and duplicated) in
`performMoveStrip` and `performTick`:
`x = mi*perform.stride + inM*perform.stepW` where `mi=floor(step/spm)`,
`inM=step-mi*spm`, `spm=perform.spm`. Extract it into a shared
`stepToX(step)` helper and use it from both call sites (resolving the logged
duplication), so the scrubber's inverse has a single source of truth to
round-trip against.

### Inverse mapping — `xToStep(x)`
Gap-aware: each measure is `measureW` wide followed by a `measGap` gap
(`stride = measureW+measGap`, `stepW = measureW/spm`). Inverse of `stepToX`:
- `mi = floor(x/stride)`; `local = x - mi*stride`;
  `inM = clamp(local/stepW, 0, spm)`; `step = mi*spm + inM`.
- Return `step` clamped to `[0, totalSteps()-1]`.
`xToStep` and the forward mapping must round-trip (within snapping tolerance).

### Drag handlers (pointer events on the performance stage)
- `pointerdown` on `#performStage`: begin a scrub — if playing, `stop()` (pause);
  cancel any running count-in; record the drag origin (pointer x) and the current
  strip translateX; set a dragging flag; `setPointerCapture`.
- `pointermove`: `newTranslateX = startTranslateX + (pointerX - startPointerX)`.
  Clamp so the scrubbed step stays in `[0, totalSteps()-1]` (i.e. clamp
  translateX to the range that keeps `xUnderPlayhead = playheadX - translateX`
  within the first/last step's x). Apply the transform directly; compute
  `step = round(xToStep(playheadX - newTranslateX))` and call
  `showPausedNotes(step)` for live feedback.
- `pointerup`/`pointercancel`: finish — `step = clamp(round(xToStep(...)))`,
  set `perform.pausedStep = step`, `performMoveStrip(step)` (snap), 
  `showPausedNotes(step)`, clear the dragging flag, set the `#performPlay` label
  to `▶ Play` (it is paused).

### CSS
- `#performStage`/`#performStrip`: `touch-action:none` (so the browser doesn't
  hijack the horizontal drag) and a `grab`/`grabbing` cursor for mouse users.

## Data flow

drag start → `stop()` (pause) → per move: translate strip + `showPausedNotes` →
release → snap to step, `pausedStep=step`, held notes shown, waiting →
`Play` → `countInThenPlay(pausedStep)` (existing).

## Edge cases

- Drag past the ends: clamp to step 0 / last step (strip can't slide beyond the
  piece).
- A tiny drag / tap: resolves to (nearly) the same step — harmless; no separate
  tap action exists on the strip.
- Drag during a count-in: `pointerdown` cancels the count-in (clears
  `perform.countTimer` + hides `#performCount`) and scrubs, leaving it paused.
- rAF vs drag: `stop()` on `pointerdown` cancels the scroll loop, so the drag has
  sole control of the transform.

## Testing / verification

Headless Chrome (pointer events dispatched via the CDP/`page.mouse` drag):
- `xToStep(stepToX(s)) === s` for sampled steps across measure boundaries
  (round-trip within snapping tolerance).
- Simulate a drag on `#performStage`: assert the strip `translateX` changes
  during the drag, playback is paused (`playing===false`, `perform.raf===0`),
  `perform.pausedStep` equals the scrubbed step (a valid in-range step), and the
  held tone-fields on `#performPan` match `grid[pausedStep]`.
- Drag beyond the start/end clamps `pausedStep` to `0` / last step.
- After a scrub, pressing Play resumes from `pausedStep` (with the count-in).
- Screenshot mid/after a drag for visual confirmation.

## Out of scope

- A separate slider/scrubber bar.
- Live audio while scrubbing (drag is silent).
- Any change to playback, count-in, speed presets, or the ⏮/⏭ jump buttons
  beyond sharing their paused/held-notes state.

## Risks

- **Gap-aware inverse correctness** — mitigated by the `xToStep`/`stepToX`
  round-trip test.
- **Touch gesture conflicts on iPad** — mitigated by `touch-action:none` +
  `setPointerCapture` + `preventDefault`, within the fixed full-screen overlay
  (no page scroll to fight).
