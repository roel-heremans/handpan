# Performance View — Drag-to-Scrub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag the perform-view notation strip (touch/mouse) to scrub back and forth through the piece, pausing playback and snapping to the nearest step, alongside the existing ⏮/⏭ jump buttons.

**Architecture:** Extract the forward step→x math into `stepToX(step)` (reused by the strip renderers) and add its gap-aware inverse `xToStep(x)`. A pointer-drag on the performance stage takes over the strip transform (pausing playback), maps drag position back to a step for live held-note feedback, and on release snaps to the nearest step and leaves the view paused at `pausedStep` — reusing the existing pause/`showPausedNotes`/count-in machinery.

**Tech Stack:** Single-file `resonote.html` (inline CSS + vanilla JS), SVG, Pointer Events. No build step. Served with `python3 -m http.server 8001`. Headless verification via `google-chrome` + `puppeteer-core` (session scratchpad).

## Global Constraints

- Single file: all code stays in `resonote.html`. No new files.
- Drag is **silent** (no audio while scrubbing); dragging **while playing pauses** first (via `stop()`), matching the ⏮/⏭ buttons.
- On release, **snap to the nearest step**, set `perform.pausedStep`, show the held tone-fields (`showPausedNotes`), leave it **paused** (`#performPlay` → `▶ Play`); **Play** resumes with the count-in (existing `performResume`/`countInThenPlay`).
- Scrub position clamps to `[0, totalSteps()-1]`.
- Presentation-only: no change to audio, count-in, speed presets, or the ⏮/⏭ buttons beyond sharing the paused/held-notes state.
- iPad: `touch-action:none` on the stage + pointer capture + `preventDefault` so the browser doesn't hijack the gesture.
- Verification: `node --check` on the extracted `<script>` for every task; a Node round-trip test for the mapping; headless-Chrome pointer-drag assertions for the interaction.

---

### Task 1: `stepToX` / `xToStep` mapping + `setStripTX`

**Files:**
- Modify: `resonote.html` — add `stepToX`, `xToStep`, `setStripTX`; refactor `performMoveStrip` and `performTick` to use them.

**Interfaces:**
- Consumes: `perform.spm`/`stride`/`stepW`/`playheadX`, `totalSteps()`, `performPos()`.
- Produces:
  - `stepToX(step)` → x in strip coords (`mi*stride + inM*stepW`).
  - `xToStep(x)` → fractional step, gap-aware inverse, clamped to `[0, totalSteps()-1]`.
  - `setStripTX(tx)` → sets `perform.tx` and the strip's `translateX`.

- [ ] **Step 1: Add the helpers**

Insert just above `performMoveStrip` (the `function performMoveStrip(step){...}` line):

```js
function setStripTX(tx){perform.tx=tx;const h=document.getElementById('performStrip');if(h)h.style.transform='translateX('+tx+'px)';}
function stepToX(step){const spm=perform.spm||1,mi=Math.floor(step/spm),inM=step-mi*spm;
  return mi*perform.stride+inM*perform.stepW;}
function xToStep(x){const spm=perform.spm||1,stride=perform.stride||1,stepW=perform.stepW||1;
  if(x<0)x=0; const mi=Math.floor(x/stride); let inM=(x-mi*stride)/stepW; if(inM>spm)inM=spm; if(inM<0)inM=0;
  let step=mi*spm+inM, max=totalSteps()-1; if(step<0)step=0; if(step>max)step=max; return step;}
```

- [ ] **Step 2: Refactor `performMoveStrip` to use them**

Replace `performMoveStrip`:

```js
function performMoveStrip(step){setStripTX(perform.playheadX-stepToX(step));}
```

- [ ] **Step 3: Refactor `performTick` to use them**

In `performTick`, replace the inline mapping block:

```js
    const pos=performPos(), mi=Math.floor(pos/perform.spm), inM=pos-mi*perform.spm;
    const x=mi*perform.stride+inM*perform.stepW;
    host.style.transform='translateX('+(perform.playheadX - x)+'px)';
```

with:

```js
    setStripTX(perform.playheadX-stepToX(performPos()));
```

(The surrounding `if(host){ ... }` and `perform.raf=requestAnimationFrame(performTick);` stay. `host` is no longer used inside — the `if(host)` guard can remain or be dropped; keep the guard to avoid touching more than needed.)

- [ ] **Step 4: Verify the round-trip in Node**

`node --check` the extracted `<script>`. Then a pure round-trip test: copy `stepToX`/`xToStep` into a temp `.js` with stubs `const perform={spm:16,stride:234,stepW:13.75,playheadX:400}; const totalSteps=()=>16*6;` and run:

```js
for(const s of [0,1,7,15,16,17,32,48,95]){
  const back=xToStep(stepToX(s));
  console.assert(Math.abs(back-s)<1e-6, 's='+s+' -> '+back);
}
console.assert(xToStep(-50)===0 && Math.abs(xToStep(1e9)-(16*6-1))<1e-6, 'clamp');
console.log('Task1 OK');
```

Expected: `Task1 OK`, no assertion failures (round-trip exact for in-range steps; clamps at both ends).

- [ ] **Step 5: Commit**

```bash
git add resonote.html
git commit -m "refactor: stepToX/xToStep mapping + setStripTX for the perform strip"
```

---

### Task 2: Drag-to-scrub pointer handlers + CSS

**Files:**
- Modify: `resonote.html` — add drag state + `onScrubDown/Move/Up`, wire to `#performStage`, add stage CSS.

**Interfaces:**
- Consumes: `stepToX`, `xToStep`, `setStripTX`, `perform.tx`/`playheadX`, `totalSteps()`, `stop()`, `playing`, `showPausedNotes`, `performMoveStrip`, `perform.countTimer`.
- Produces: pointer-drag scrubbing on the performance stage.

- [ ] **Step 1: Add the drag handlers**

Insert after `performForward` (the `function performForward(){...}` line):

```js
// Drag the notation to scrub. A drag pauses playback, follows the finger, and on
// release snaps to the nearest step (paused, held tone-fields shown). Tap (no drag) does nothing.
let dragStartX=0,dragStartTX=0,dragPending=false;
function scrubClampTX(tx){const a=perform.playheadX-stepToX(0),z=perform.playheadX-stepToX(totalSteps()-1);
  const hi=Math.max(a,z),lo=Math.min(a,z); return tx>hi?hi:(tx<lo?lo:tx);}
function onScrubDown(e){ if(!perform.active)return;
  dragPending=true; perform.dragging=false;
  dragStartX=e.clientX; dragStartTX=perform.tx!=null?perform.tx:perform.playheadX;
  try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_){}}
function onScrubMove(e){
  if(!dragPending&&!perform.dragging)return;
  const dx=e.clientX-dragStartX;
  if(!perform.dragging){ if(Math.abs(dx)<4)return;               // movement threshold: a tap won't scrub
    perform.dragging=true;
    if(perform.countTimer){clearTimeout(perform.countTimer);perform.countTimer=null;
      const c=document.getElementById('performCount');if(c){c.style.display='none';c.textContent='';}}
    if(playing)stop(); }                                          // pause on real drag
  const tx=scrubClampTX(dragStartTX+dx);
  setStripTX(tx);
  showPausedNotes(Math.round(xToStep(perform.playheadX-tx)));
  e.preventDefault();
}
function onScrubUp(e){ dragPending=false;
  if(!perform.dragging)return; perform.dragging=false;
  const step=Math.round(xToStep(perform.playheadX-(perform.tx!=null?perform.tx:perform.playheadX)));
  perform.pausedStep=step; performMoveStrip(step); showPausedNotes(step);
  const b=document.getElementById('performPlay');if(b)b.textContent='▶ Play';
  try{e.currentTarget.releasePointerCapture(e.pointerId);}catch(_){}}
```

- [ ] **Step 2: Wire the handlers to the stage**

Near the other perform listeners (after `document.getElementById('performNext').addEventListener('click',performForward);`):

```js
(function(){const stg=document.getElementById('performStage');
  stg.addEventListener('pointerdown',onScrubDown);
  stg.addEventListener('pointermove',onScrubMove);
  stg.addEventListener('pointerup',onScrubUp);
  stg.addEventListener('pointercancel',onScrubUp);})();
```

- [ ] **Step 3: Stage CSS (no gesture hijack + grab cursor)**

In the `.perform-stage{...}` rule, add `touch-action:none` and a grab cursor. Replace the rule:

```css
.perform-stage{position:relative;flex:0 0 auto;height:184px;overflow:hidden;margin-top:14px;touch-action:none;cursor:grab}
.perform-stage:active{cursor:grabbing}
```

(The `height` is overridden per-render by `renderPerformStrip`; the other properties are unchanged from the current rule.)

- [ ] **Step 4: Verify**

`node --check`. Then headless (puppeteer-core from the scratchpad dir, system google-chrome, args `['--no-sandbox','--autoplay-policy=no-user-gesture-required']`): load the app, set a multi-measure pattern with notes, `countIn=0`, enter perform, let it play briefly, then drag on the stage with `page.mouse` (down → several moves → up) toward the right (go back), and assert:

```js
// after a right-drag: paused, transform changed, pausedStep landed in-range on a step, held notes match grid[pausedStep]
const r=await page.evaluate(()=>({playing,raf:perform.raf,paused:perform.pausedStep,
  held:[...document.querySelectorAll('#performPan .held,#performPan .held-L')].map(e=>e.getAttribute('data-voice')).sort(),
  gridAt:Object.keys(state.grid[perform.pausedStep]||{}).filter(v=>!['H','T','S','G'].includes(v)).sort()}));
// expect: r.playing===false, r.raf===0, r.paused is an integer in [0,totalSteps-1], r.held deep-equals r.gridAt
```

Also assert a very large drag clamps `perform.pausedStep` to `0` (drag right past the start) or `totalSteps-1` (drag left past the end), and that a tiny (<4px) drag/tap does NOT change `playing`. Paste the drag script + output into the report.

- [ ] **Step 5: Commit**

```bash
git add resonote.html
git commit -m "feat: drag the perform notation to scrub through the piece"
```

---

### Task 3: Calibration & verification pass (controller-driven, headless)

**Files:**
- Modify: `resonote.html` — drag-feel tuning only (threshold, cursor) if needed.

**Interfaces:** none new.

- [ ] **Step 1: Full headless drag run + screenshot**

Drive the app in headless Chrome: enter perform on a multi-measure pattern, drag the strip left and right with `page.mouse`, and screenshot mid-drag and after release. Confirm the strip follows the drag, the pan's held tone-fields update live, and it lands paused on a step.

- [ ] **Step 2: Verify against the spec**

Confirm: dragging pauses playback and scrubs silently; live held-note feedback while dragging; release snaps to the nearest step and stays paused; Play then resumes from the scrubbed step with the count-in; clamps at the ends; a tap doesn't scrub; ⏮/⏭ still work. Screenshot for the record.

- [ ] **Step 3: Tune + commit**

Adjust the movement threshold / cursor only if the feel needs it. Commit:

```bash
git add resonote.html
git commit -m "chore: verify + calibrate perform drag-to-scrub"
```

---

## Self-review notes

- **Spec coverage:** `stepToX`/`xToStep`/`setStripTX` + renderer refactor (Task 1); drag handlers, stage wiring, `touch-action:none` + grab cursor, pause-on-drag, live held notes, snap-on-release, clamp, tap-guard (Task 2); end-to-end + visual verification (Task 3). All spec sections mapped.
- **Placeholder scan:** every code step has real code; verification steps give concrete Node/headless snippets and expected values.
- **Type consistency:** `stepToX(step)`/`xToStep(x)`/`setStripTX(tx)` defined in Task 1 are consumed by `performMoveStrip`/`performTick` (Task 1) and the drag handlers (Task 2). `perform.tx` set by `setStripTX` (Task 1) is read by the drag handlers (Task 2). `perform.dragging` is introduced in Task 2 only. Reuses `showPausedNotes`/`performMoveStrip`/`stop`/`performForward` with their existing signatures.
```
