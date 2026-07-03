# Performance View — Transport Controls — Design

Date: 2026-07-04
Status: Approved (design), pending spec review

## Goal

Add four transport controls to the performance view:

1. **Count-in** — a configurable delay (X seconds) after pressing ▶ Perform
   before playback/scrolling begins, shown as a big on-screen countdown.
2. **Speed presets** — 0.5× / 0.75× / 1× / 1.25× of the pattern's own tempo,
   changeable live during a performance.
3. **Pause / Play** — pause freezes and *resumes from where it was paused*
   (not a restart).
4. **Rewind (◀)** — jump the playhead back to the start of the current measure
   (or the previous measure if already near the start).

## Decisions

- Speed control = **presets** (no fine slider).
- Rewind granularity = **previous measure**.
- Count-in = **big on-screen count** (3… 2… 1…), value configurable, default 3s;
  `0` disables it.
- Pause = **resume from position**.
- The count-in value is set in the **editor** (next to ▶ Perform) — the setting
  must be chosen before performing.
- Presentation-only otherwise: no pattern/instrument editing in the view.

## Foundation — `play(fromStep)`

Today `play()` always starts at `curStep=0`. Generalize it to accept an optional
`fromStep` (default `0`, so existing editor callers are unchanged):

- `curStep = fromStep|0`
- `nextTime = ctx.currentTime + lead`
- `playAnchor = nextTime - curStep*stepDur()` — so the scroll maps `curStep` to
  the playhead correctly.

Pause/resume, rewind, and speed-change all build on this plus re-anchoring the
scroll clock (`playAnchor`).

## Components

### Count-in
- Editor: a compact `Count-in [3] s` number input beside the ▶ Perform button;
  stored in a variable (e.g. `perform.countIn`, default 3, clamp 0–9).
- `enterPerform()` shows the overlay + pan + strip at position 0, then runs the
  count-in: a large centered number decrements each second; at 0 it starts
  playback (`play()`) and the scroll loop. `countIn===0` starts immediately.
- Exit/Esc during the count-in cancels it cleanly (clear the timer, no playback).

### Speed presets
- Perform bar: buttons `0.5× 0.75× 1× 1.25×`. On entry capture
  `perform.baseTempo = state.tempo`; the active preset is highlighted (1× default).
- Tapping a preset: capture current position `p = performPos()`, set
  `state.tempo = round(baseTempo*mult)`, re-anchor
  `playAnchor = ctx.currentTime - p*stepDur()` (stepDur now uses the new tempo),
  update the bpm readout, and highlight the active button. The scheduler already
  recomputes `stepDur()` each step, so audio follows; re-anchoring keeps the
  scroll synced.

### Pause / Play
- The bar's main button toggles **⏸ Pause / ▶ Play**.
- Pause: capture `perform.pausedStep = Math.round(performPos())`, then `stop()`
  (halts scheduler + rAF + audio; strip freezes at its current transform).
- Play: `play(perform.pausedStep||0)` + `startPerformLoop()`, clear
  `pausedStep`, set label to ⏸ Pause.

### Rewind (◀ previous measure)
- Compute `pos = performPos()`, `spm = beats*sub`, `m = floor(pos/spm)`; if
  `pos - m*spm < sub*0.5` (near the measure start) target `m-1` else `m`, clamped
  `≥ 0`; `targetStep = target*spm`.
- If currently playing: `play(targetStep)` (restart scheduler from there,
  re-anchored). If paused: set `perform.pausedStep = targetStep` and move the
  strip to that position so Play resumes there.

## Perform bar layout

`◀   ⏸/▶    0.5×  0.75×  1×  1.25×    <bpm> bpm  ·····  ✕ Exit`

## State additions

`perform` gains: `baseTempo`, `countIn` (default 3), `pausedStep`, and a
`countTimer` handle for the count-in. No saved-pattern schema change.

## Testing / verification

Headless Chrome harness:
- Count-in: with `countIn=2`, playback/scroll do not start until ~2s after
  Perform; the count number is visible; Exit during count-in cancels it.
- Speed: tapping 0.5× sets `state.tempo` to half `baseTempo` and the scroll rate
  halves while staying synced (position continuous across the change).
- Pause/Play: Pause freezes the strip (`raf=0`, position stable) and Play
  resumes from the paused step (not step 0).
- Rewind: from mid-piece, ◀ snaps the playhead to a measure boundary; near a
  boundary it goes to the previous measure.
- Editor unchanged: the plain ▶ Play button still starts from step 0.

## Out of scope

- A fine bpm slider (presets only).
- Rewind by beat or a forward/next control.
- Applying per-measure tempo marks during playback (still display-only).
- Persisting count-in / speed across sessions.

## Risks

- **Scroll↔audio sync across a live tempo change** — mitigated by re-anchoring
  `playAnchor` from the preserved fractional position at the moment of change.
- **Resume-from-step correctness** — `play(fromStep)` anchors the scroll to the
  same step the scheduler resumes from, so audio and playhead agree.
