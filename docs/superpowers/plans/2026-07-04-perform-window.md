# Performance View — 3-Measure Window + PDF-Style Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Frame ~3 measures (prev/current/next) in the perform view with a centered playhead and reference-PDF-style black beat/bar lines, and make ◀ rewind one whole measure per press.

**Architecture:** Keep the continuous scroll; size each measure to ~⅓ of the stage width and center the playhead (in `enterPerform`); extend the existing perform-only `SCORE` override in `renderPerformStrip` to darken ticks + thicken the barline (restored in the existing `finally`, so the PDF export is unchanged); change `performRewind` to target the previous measure boundary.

**Tech Stack:** Single-file `resonote.html` (inline CSS + vanilla JS), SVG. No build step. Served with `python3 -m http.server 8001`. Headless verification via `google-chrome` + `puppeteer-core` (session scratchpad).

## Global Constraints

- Single file: all code stays in `resonote.html`. No new files.
- Motion stays continuous scroll; only framing + line styling change.
- The PDF/print export appearance must be unchanged: every perform-only `SCORE`
  override stays inside the existing try/finally save/restore in `renderPerformStrip`.
- ~3 measures visible: `perform.measureW ≈ round(stageWidth/3)` (floor 200); playhead centered (`stageWidth*0.5`).
- Rewind = previous measure boundary per press (two presses → two measures back).
- Verification: `node --check` on the extracted `<script>` for every task; headless-Chrome assertions for behavior; screenshot compared to `assets/patterns/Happy Birthday - Popular.pdf` page 2.

---

### Task 1: Three-measure framing + PDF-style black lines

**Files:**
- Modify: `resonote.html` — `enterPerform` (measure width + centered playhead) and `renderPerformStrip` (darken ticks + thicken barline inside the existing override).

**Interfaces:**
- Consumes: `perform` object, `SCORE`, `renderPerformStrip`, stage element.
- Produces: `perform.measureW` set to ~stage/3 on entry; centered `perform.playheadX`; perform strip rendered with dark ticks + bold barline (PDF export unchanged).

- [ ] **Step 1: Set measure width + centered playhead in `enterPerform`**

Find the block in `enterPerform`:

```js
  const stage=document.getElementById('performStage');
  perform.playheadX=Math.round(stage.clientWidth*0.30);
  document.getElementById('performPlayhead').style.left=perform.playheadX+'px';
```

Replace it with:

```js
  const stage=document.getElementById('performStage');
  perform.measureW=Math.max(200,Math.round(stage.clientWidth/3));   // ~3 measures span the stage
  perform.playheadX=Math.round(stage.clientWidth*0.5);              // centered playhead
  document.getElementById('performPlayhead').style.left=perform.playheadX+'px';
```

- [ ] **Step 2: Darken ticks + thicken barline in the perform-only override**

In `renderPerformStrip`, the `save` object and the override line currently are:

```js
  const save={half:SCORE.half,staffH:SCORE.staffH,tickTall:SCORE.tickTall,tickShort:SCORE.tickShort,numFont:SCORE.numFont,numStep:SCORE.numStep,measNumFont:SCORE.measNumFont};
```
and inside the `try`:
```js
    SCORE.half=48;SCORE.staffH=100;SCORE.tickTall=34;SCORE.tickShort=18;SCORE.numFont=26;SCORE.numStep=30;SCORE.measNumFont=13;
```

Add `tickGray` and `barW` to the saved set and to the override. Replace the `save` line with:

```js
  const save={half:SCORE.half,staffH:SCORE.staffH,tickTall:SCORE.tickTall,tickShort:SCORE.tickShort,numFont:SCORE.numFont,numStep:SCORE.numStep,measNumFont:SCORE.measNumFont,tickGray:SCORE.tickGray,barW:SCORE.barW};
```

and replace the override line inside the `try` with:

```js
    SCORE.half=48;SCORE.staffH=100;SCORE.tickTall=34;SCORE.tickShort=18;SCORE.numFont=26;SCORE.numStep=30;SCORE.measNumFont=13;SCORE.tickGray=[40,40,40];SCORE.barW=3;
```

(The existing `finally { Object.assign(SCORE,save); }` already restores every field, so the PDF/print path keeps the original `tickGray`/`barW`.)

- [ ] **Step 3: Verify**

`node --check` the extracted `<script>`. Then headless (puppeteer-core from the scratchpad dir, system google-chrome, args `['--no-sandbox','--autoplay-policy=no-user-gesture-required']`), load `http://localhost:8001/resonote.html`:

```js
await page.evaluate(()=>{state.measures=6;state.tempo=120;state.grid={0:{'3':'R'},2:{'4':'L'},8:{'5':'R'},16:{'7':'R'},32:{'9':'R'}};document.getElementById('countIn').value='0';renderAll();});
await page.click('#performBtn'); await sleep(300);
const r=await page.evaluate(()=>{
  const stage=document.getElementById('performStage');
  const svg=document.getElementById('performStrip').innerHTML;
  return {measW:perform.measureW, stageW:stage.clientWidth, phFrac:perform.playheadX/stage.clientWidth,
    barW3:/stroke-width="3"/.test(svg), darkTick:/stroke="rgb\(40,40,40\)"/.test(svg),
    scoreRestored:JSON.stringify(SCORE.tickGray)==='[150,150,150]'&&SCORE.barW===1.4};
});
console.log(r);
// measW ≈ round(stageW/3); phFrac ≈ 0.5; barW3 true; darkTick true; scoreRestored true
```

Expected: `measW` within ±2 of `round(stageW/3)`; `phFrac` in [0.48,0.52]; `barW3===true`; `darkTick===true`; `scoreRestored===true` (override did not leak). Also take an overlay screenshot for visual comparison to the reference PDF.

- [ ] **Step 4: Commit**

```bash
git add resonote.html
git commit -m "feat: perform view frames ~3 measures with centered playhead + PDF-style black lines"
```

---

### Task 2: Rewind = previous measure per press

**Files:**
- Modify: `resonote.html` — `performRewind`.

**Interfaces:**
- Consumes: `performPos()`, `perform.pausedStep`, `performSeek()`.
- Produces: `performRewind()` targeting the previous measure boundary.

- [ ] **Step 1: Change the target to the previous measure**

Replace `performRewind`:

```js
function performRewind(){const spm=state.beats*state.sub;
  const pos=playing?performPos():(perform.pausedStep||0);       // when paused, the clock keeps advancing — use the frozen step
  const m=Math.floor(pos/spm);
  const target=Math.max(0,m-1)*spm;performSeek(target);}
```

- [ ] **Step 2: Verify**

`node --check`. Headless: play into measure 3, then press ◀ twice, confirm each press moves back one measure boundary:

```js
await page.evaluate(()=>{state.measures=6;state.loop=true;state.tempo=240;state.beats=4;state.sub=4;state.grid={0:{'3':'R'},16:{'7':'R'},32:{'9':'R'}};document.getElementById('countIn').value='0';renderAll();});
await page.click('#performBtn'); await sleep(1500);            // into a later measure
await page.evaluate(()=>togglePerformPlayback());             // pause so positions are stable
const spm=await page.evaluate(()=>state.beats*state.sub);
const start=await page.evaluate(()=>perform.pausedStep);
await page.evaluate(()=>performRewind());
const after1=await page.evaluate(()=>perform.pausedStep);
await page.evaluate(()=>performRewind());
const after2=await page.evaluate(()=>perform.pausedStep);
console.log('spm',spm,'start',start,'after1',after1,'after2',after2);
// after1 = (floor(start/spm)-1)*spm ; after2 = after1 - spm ; both multiples of spm, clamped >=0
```

Expected: `after1` and `after2` are measure boundaries (multiples of `spm`), and `after2 === Math.max(0, after1 - spm)` — i.e. two presses move back two measures (clamped at 0).

- [ ] **Step 3: Commit**

```bash
git add resonote.html
git commit -m "feat: rewind jumps one full measure per press (two presses = two measures)"
```

---

### Task 3: Calibration & verification pass (controller-driven, headless)

**Files:**
- Modify: `resonote.html` — line-weight / tick-color / measure-width tuning only.

**Interfaces:** none new.

- [ ] **Step 1: Screenshot and compare to the reference**

Drive the app in headless Chrome: multi-measure pattern with marks, enter perform, screenshot the overlay mid-scroll. Compare the notation line treatment (bold barline, taller black beat lines, short subdivision ticks, centered numbers) against `assets/patterns/Happy Birthday - Popular.pdf` page 2.

- [ ] **Step 2: Verify against the spec**

Confirm: ~3 measures visible around the centered playhead; previous slides off left / next enters right as it scrolls; bold black barlines + taller black beat lines + short subdivision ticks; numbers centered on their cell (orange above / blue below); a generated PDF still uses the original gray ticks / thin barline (SCORE restored).

- [ ] **Step 3: Tune + commit**

Adjust `perform.measureW` divisor / floor, the override `tickGray` darkness, `barW` thickness, and (if beat lines need to read bolder than subdivisions) the tick heights — until it matches the reference. Commit:

```bash
git add resonote.html
git commit -m "chore: calibrate perform 3-measure window + line weights to the reference PDF"
```

---

## Self-review notes

- **Spec coverage:** 3-measure framing + centered playhead (Task 1 Step 1); PDF-style black lines, perform-only, PDF export unchanged (Task 1 Step 2, restored by the existing finally); rewind = previous measure (Task 2); calibration + PDF-unchanged regression (Tasks 1 & 3). All spec sections mapped.
- **Placeholder scan:** every code step has real code; verification steps give concrete headless snippets and expected values.
- **Type consistency:** `perform.measureW`/`playheadX` set in `enterPerform` (Task 1) are consumed by `renderPerformStrip` (unchanged consumer) and the scroll loop; `save`/override field set additions (`tickGray`,`barW`) are both added, so the finally restores them; `performRewind` (Task 2) reuses `performPos`/`perform.pausedStep`/`performSeek` unchanged.
```
