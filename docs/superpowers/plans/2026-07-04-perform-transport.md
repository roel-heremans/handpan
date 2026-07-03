# Performance-View Transport Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a count-in, speed presets, pause/resume-from-position, and a rewind-to-previous-measure control to the performance view.

**Architecture:** Generalize `play()` to start from any step (`play(fromStep)`, default 0 so the editor is unchanged) and anchor the scroll clock to that step. Pause/resume, rewind, and live speed changes all build on that plus re-anchoring `playAnchor`. All new UI lives in the existing perform overlay/bar; the count-in value is set by an editor input read on entry.

**Tech Stack:** Single-file `resonote.html` (inline CSS + vanilla JS), SVG, Web Audio (existing). No build step. Served with `python3 -m http.server 8001`. Headless verification via `google-chrome` + `puppeteer-core` (session scratchpad).

## Global Constraints

- Single file: all code stays in `resonote.html` (existing pattern). No new files.
- Presentation-only: the performance view never edits the pattern or instrument; on exit, restore `state.tempo` to the pattern's value.
- Editor's plain ▶ Play must be unchanged (starts from step 0).
- Scroll stays synced to the audio clock (`ctx.currentTime`) across pause/resume, rewind, and speed changes by re-anchoring `playAnchor`.
- Speed presets are relative to the pattern's own tempo captured on entry (`perform.baseTempo`): 0.5× / 0.75× / 1× / 1.25×.
- Rewind granularity = previous measure. Count-in default 3s, range 0–9, `0` disables.
- Verification: `node --check` on the extracted `<script>` for every task; headless-Chrome behavioral assertions (read `state.tempo`, `curStep`, `performPos()`, `perform.*`, element state) for the interactive behavior.

---

### Task 1: `play(fromStep)` foundation

**Files:**
- Modify: `resonote.html` — `function play(){...}`

**Interfaces:**
- Produces: `play(fromStep)` — starts playback at `curStep = fromStep|0` (default 0) and sets `playAnchor = nextTime - curStep*stepDur()` so the scroll maps that step to the playhead. Non-loop end timer uses the remaining steps.

- [ ] **Step 1: Generalize `play`**

Replace the whole `play` function:

```js
function play(fromStep){resumeAudio();if(playing)return;playing=true;curStep=(fromStep|0);nextTime=ctx.currentTime+.06;
  playAnchor=nextTime-curStep*stepDur();
  const btn=document.getElementById('playBtn');btn.textContent='■ Stop';btn.classList.remove('primary');btn.classList.add('playing');scheduler();
  if(!state.loop)endTimer=setTimeout(()=>{if(playing&&!state.loop)stop();},(totalSteps()-curStep)*stepDur()*1000+400);}
```

- [ ] **Step 2: Verify editor path unchanged + resume-from-step**

`node --check` the extracted `<script>`. Then headless (puppeteer): load the app, then:

```js
// no-arg play starts at 0
await page.evaluate(()=>{resumeAudio();play();});
const a=await page.evaluate(()=>curStep); // expect 0
await page.evaluate(()=>stop());
// play(4) starts at step 4 and anchors scroll there
await page.evaluate(()=>{play(4);});
const b=await page.evaluate(()=>({cur:curStep, pos:performPos()}));
await page.evaluate(()=>stop());
console.log('play():',a,'| play(4):',b); // a===0; b.cur===4; b.pos≈4 (0..4.2)
```

Expected: `a===0`, `b.cur===4`, `b.pos` within ~[3.8,4.3].

- [ ] **Step 3: Commit**

```bash
git add resonote.html
git commit -m "feat: play(fromStep) — start playback from an arbitrary step"
```

---

### Task 2: Pause / resume-from-position

**Files:**
- Modify: `resonote.html` — perform bar button label (`#performPlay`), `enterPerform`, `togglePerformPlayback`; add `perform.pausedStep`.

**Interfaces:**
- Consumes: `play(fromStep)` (Task 1), `stop()`, `startPerformLoop()`, `performPos()`.
- Produces: `performPause()`, `performResume()`; `togglePerformPlayback()` now pauses/resumes (used by the button and Space).

- [ ] **Step 1: Relabel the bar button**

In the perform bar markup, change the button text from `■ Stop` to `⏸ Pause`:

```html
    <button class="btn" id="performPlay">⏸ Pause</button>
```

- [ ] **Step 2: Add pause/resume and rewrite the toggle**

Add `pausedStep:null` to the `perform` object initializer (add the property). Then replace `togglePerformPlayback` and add the two helpers just above it:

```js
function performPause(){if(!playing)return;perform.pausedStep=Math.round(performPos());stop();}
function performResume(){play(perform.pausedStep||0);startPerformLoop();perform.pausedStep=null;
  const b=document.getElementById('performPlay');if(b)b.textContent='⏸ Pause';}
function togglePerformPlayback(){if(playing)performPause();else performResume();}
```

(`stop()` already resets `#performPlay` to `▶ Play`, so pause shows the right label.)

- [ ] **Step 3: Set the initial label in `enterPerform`**

In `enterPerform`, change the final label line from `'■ Stop'` to `'⏸ Pause'`:

```js
  document.getElementById('performPlay').textContent='⏸ Pause';
```

- [ ] **Step 4: Verify**

`node --check`. Headless: enter perform, let it play ~500ms, pause, confirm frozen + step remembered, resume, confirm it continues from the paused step (not 0):

```js
await page.evaluate(()=>{state.measures=4;state.loop=true;state.tempo=120;state.grid={0:{'3':'R'},16:{'7':'R'},32:{'9':'R'}};renderAll();});
await page.click('#performBtn'); await sleep(600);
await page.evaluate(()=>togglePerformPlayback());           // pause
const p=await page.evaluate(()=>({raf:perform.raf,playing,paused:perform.pausedStep}));
await sleep(300);
await page.evaluate(()=>togglePerformPlayback());           // resume
const r=await page.evaluate(()=>({playing,cur:curStep}));
console.log('paused:',p,'resumed:',r);   // p.playing===false, p.paused>0; r.playing===true, r.cur===p.paused
```

Expected: paused `playing===false`, `pausedStep>0`; resumed `playing===true`, `curStep===` the paused step.

- [ ] **Step 5: Commit**

```bash
git add resonote.html
git commit -m "feat: pause/resume-from-position in the performance view"
```

---

### Task 3: Rewind — ◀ previous measure

**Files:**
- Modify: `resonote.html` — add `#performPrev` button to the bar; add `performSeek`, `performMoveStrip`, `performRewind`; wire the button.

**Interfaces:**
- Consumes: `play(fromStep)`, `stop()`, `startPerformLoop()`, `performPos()`, `perform.stride`/`stepW`/`spm`/`playheadX`/`pausedStep`.
- Produces: `performRewind()` (bound to `#performPrev`).

- [ ] **Step 1: Add the ◀ button (first in the bar)**

In the perform bar, add as the first control (before `#performPlay`):

```html
    <button class="btn" id="performPrev">◀</button>
```

- [ ] **Step 2: Add seek + rewind helpers**

Add near `performResume`:

```js
function performMoveStrip(step){const host=document.getElementById('performStrip');if(!host)return;
  const spm=perform.spm||1,mi=Math.floor(step/spm),inM=step-mi*spm;
  const x=mi*perform.stride+inM*perform.stepW;host.style.transform='translateX('+(perform.playheadX-x)+'px)';}
function performSeek(step){const was=playing;stop();
  if(was){play(step);startPerformLoop();document.getElementById('performPlay').textContent='⏸ Pause';}
  else{perform.pausedStep=step;performMoveStrip(step);}}
function performRewind(){const spm=state.beats*state.sub,pos=performPos(),m=Math.floor(pos/spm);
  const target=((pos-m*spm)<state.sub*0.5?Math.max(0,m-1):m)*spm;performSeek(target);}
```

- [ ] **Step 3: Wire the button**

Near the other perform listeners:

```js
document.getElementById('performPrev').addEventListener('click',performRewind);
```

- [ ] **Step 4: Verify**

`node --check`. Headless: play into measure 2, rewind, confirm it snaps to a measure boundary (multiple of `spm`) at or before the current measure:

```js
await page.evaluate(()=>{state.measures=4;state.loop=true;state.tempo=200;state.beats=4;state.sub=4;state.grid={0:{'3':'R'},16:{'7':'R'}};renderAll();});
await page.click('#performBtn'); await sleep(900);              // ~into measure 2 (spm=16)
const before=await page.evaluate(()=>Math.floor(performPos()));
await page.evaluate(()=>performRewind());
await sleep(50);
const after=await page.evaluate(()=>({cur:curStep, spm:state.beats*state.sub}));
console.log('before step:',before,'after rewind curStep:',after.cur,'spm:',after.spm);
// after.cur % after.spm === 0 (a measure boundary) and after.cur <= (measure of before)*spm
```

Expected: `after.cur % after.spm === 0`.

- [ ] **Step 5: Commit**

```bash
git add resonote.html
git commit -m "feat: rewind to previous measure in the performance view"
```

---

### Task 4: Speed presets

**Files:**
- Modify: `resonote.html` — add speed buttons + CSS to the bar; capture `perform.baseTempo` in `enterPerform`; add `setPerformSpeed`; restore tempo in `exitPerform`; wire buttons.

**Interfaces:**
- Consumes: `performPos()`, `stepDur()`, `state.tempo`, `perform.baseTempo`.
- Produces: `setPerformSpeed(mult)` (bound to `.perf-speed` buttons).

- [ ] **Step 1: Add speed buttons to the bar**

Insert after `#performPlay`:

```html
    <span class="perf-speeds">
      <button class="perf-speed" data-mult="0.5">0.5×</button>
      <button class="perf-speed" data-mult="0.75">0.75×</button>
      <button class="perf-speed sel" data-mult="1">1×</button>
      <button class="perf-speed" data-mult="1.25">1.25×</button>
    </span>
```

- [ ] **Step 2: Add CSS**

In `<style>`:

```css
.perf-speeds{display:flex;gap:5px}
.perf-speed{background:#2a303a;border:1px solid #3a424e;color:#cfd6df;border-radius:7px;padding:6px 9px;font-size:13px;font-family:var(--mono);cursor:pointer}
.perf-speed:hover{background:#333b47}
.perf-speed.sel{background:#E8971E;border-color:#E8971E;color:#231a08;font-weight:600}
```

- [ ] **Step 3: Capture base tempo + default highlight in `enterPerform`**

In `enterPerform`, right after `perform.active=true;`, add:

```js
  perform.baseTempo=state.tempo;
  document.querySelectorAll('#performOverlay .perf-speed').forEach(b=>b.classList.toggle('sel',+b.dataset.mult===1));
```

- [ ] **Step 4: Add `setPerformSpeed` and restore tempo on exit**

Add near `setPerformSpeed`'s siblings:

```js
function setPerformSpeed(mult){
  const p=performPos();
  state.tempo=Math.round((perform.baseTempo||state.tempo)*mult);
  if(playing&&ctx)playAnchor=ctx.currentTime-p*stepDur();     // keep the scroll synced across the tempo change
  const tv=document.getElementById('performTempo');if(tv)tv.textContent=state.tempo+' bpm';
  document.querySelectorAll('#performOverlay .perf-speed').forEach(b=>b.classList.toggle('sel',+b.dataset.mult===mult));
}
```

In `exitPerform`, restore the pattern tempo and refresh the editor's tempo UI — replace the body of `exitPerform` with:

```js
function exitPerform(){
  if(!perform.active)return;
  if(perform.countTimer){clearTimeout(perform.countTimer);perform.countTimer=null;}
  stopPerformLoop(); stop(); perform.active=false;
  if(perform.baseTempo){state.tempo=perform.baseTempo;
    const t=document.getElementById('tempo'),tv=document.getElementById('tempoVal');
    if(t)t.value=state.tempo; if(tv)tv.textContent=state.tempo;}
  document.getElementById('performOverlay').style.display='none';
}
```

(`perform.countTimer` is used by Task 5; the guard is harmless before then since it's `undefined`.)

- [ ] **Step 5: Wire the buttons**

Near the other perform listeners:

```js
document.querySelectorAll('#performOverlay .perf-speed').forEach(b=>b.addEventListener('click',()=>setPerformSpeed(+b.dataset.mult)));
```

- [ ] **Step 6: Verify**

`node --check`. Headless: enter at 120bpm, tap 0.5×, confirm `state.tempo===60`, the `1×`→`0.5×` highlight moves, and the scroll position is continuous (no jump) across the change; exit restores 120:

```js
await page.evaluate(()=>{state.measures=4;state.loop=true;state.tempo=120;state.grid={0:{'3':'R'},16:{'7':'R'}};renderAll();});
await page.click('#performBtn'); await sleep(500);
const p0=await page.evaluate(()=>performPos());
await page.evaluate(()=>setPerformSpeed(0.5));
const s=await page.evaluate(()=>({tempo:state.tempo, sel:document.querySelector('#performOverlay .perf-speed.sel').dataset.mult, pos:performPos()}));
await page.evaluate(()=>exitPerform());
const ex=await page.evaluate(()=>state.tempo);
console.log('after 0.5x:',s,'| pos before:',p0,'| tempo after exit:',ex);
// s.tempo===60, s.sel==='0.5', |s.pos-p0| small (<0.5), ex===120
```

Expected: `s.tempo===60`, `s.sel==='0.5'`, `|s.pos−p0| < 0.6`, `ex===120`.

- [ ] **Step 7: Commit**

```bash
git add resonote.html
git commit -m "feat: performance-view speed presets (0.5x-1.25x) with live re-sync"
```

---

### Task 5: Count-in

**Files:**
- Modify: `resonote.html` — editor `Count-in` input near `#performBtn`; overlay count element + CSS; refactor `enterPerform` to run the count-in; add `runCountIn` + `startPerformPlayback`.

**Interfaces:**
- Consumes: `stop()`, `play()`, `startPerformLoop()`, `performMoveStrip()` (Task 3), `perform`.
- Produces: `perform.countIn`, `perform.countTimer`, `runCountIn(n,done)`, `startPerformPlayback()`.

- [ ] **Step 1: Editor count-in input**

Next to the ▶ Perform button (after `<button ... id="performBtn">⤢ Perform</button>`), add:

```html
          <label class="toggle" style="gap:4px">Count-in <input type="number" id="countIn" min="0" max="9" value="3" style="width:44px;background:var(--steel-2);border:1px solid var(--line);border-radius:7px;padding:5px 6px;color:var(--text)"/> s</label>
```

- [ ] **Step 2: Overlay count element + CSS**

In the overlay markup (inside `#performOverlay`, after `.perform-bar`), add:

```html
  <div class="perform-count" id="performCount"></div>
```

In `<style>`:

```css
.perform-count{position:absolute;inset:0;display:none;align-items:center;justify-content:center;font-size:min(28vh,240px);font-weight:700;color:rgba(232,151,30,.92);z-index:5;pointer-events:none}
```

- [ ] **Step 3: Refactor `enterPerform` to run the count-in**

Replace `enterPerform`'s tail (from `if(!playing)play();`/`stop(); play();` through the label line) so it renders at position 0 and runs the count-in before playing. The full function:

```js
function enterPerform(){
  if(perform.active)return;
  document.getElementById('performTempo').textContent=state.tempo+' bpm';
  document.getElementById('performOverlay').style.display='flex';
  perform.active=true;
  perform.baseTempo=state.tempo;
  document.querySelectorAll('#performOverlay .perf-speed').forEach(b=>b.classList.toggle('sel',+b.dataset.mult===1));
  const stage=document.getElementById('performStage');
  perform.playheadX=Math.round(stage.clientWidth*0.30);
  document.getElementById('performPlayhead').style.left=perform.playheadX+'px';
  renderPerformPan(); renderPerformStrip();
  performMoveStrip(0);
  const n=Math.max(0,Math.min(9,parseInt((document.getElementById('countIn')||{}).value||'0',10)||0));
  perform.countIn=n;
  if(n>0)runCountIn(n,startPerformPlayback); else startPerformPlayback();
}
function startPerformPlayback(){
  stop(); play(); startPerformLoop();
  document.getElementById('performPlay').textContent='⏸ Pause';
}
function runCountIn(n,done){
  const el=document.getElementById('performCount'); let k=n;
  const tick=()=>{ if(!perform.active)return;
    if(k<=0){el.style.display='none';el.textContent='';done();return;}
    el.style.display='flex'; el.textContent=k; k--; perform.countTimer=setTimeout(tick,1000); };
  tick();
}
```

(`exitPerform` already clears `perform.countTimer` and hides — from Task 4. Also ensure the count element is hidden on exit: add `const c=document.getElementById('performCount');if(c){c.style.display='none';c.textContent='';}` inside `exitPerform` before hiding the overlay.)

- [ ] **Step 4: Hide the count on exit**

In `exitPerform`, just before `document.getElementById('performOverlay').style.display='none';`, add:

```js
  const c=document.getElementById('performCount');if(c){c.style.display='none';c.textContent='';}
```

- [ ] **Step 5: Verify**

`node --check`. Headless: set count-in to 2, press Perform, confirm playback does NOT start for ~2s and the count is visible, then starts; and exit during the count cancels it:

```js
await page.evaluate(()=>{document.getElementById('countIn').value='2';state.measures=4;state.loop=true;state.tempo=120;state.grid={0:{'3':'R'}};renderAll();});
await page.click('#performBtn'); await sleep(500);
const during=await page.evaluate(()=>({playing,count:document.getElementById('performCount').textContent,disp:document.getElementById('performCount').style.display}));
await sleep(1900);
const after=await page.evaluate(()=>({playing,disp:document.getElementById('performCount').style.display}));
console.log('during count:',during,'| after count:',after);
// during.playing===false, during.count is "2" or "1", during.disp==='flex'; after.playing===true, after.disp==='none'
```

Expected: during the count `playing===false` and the count element shows a number; after ~2.4s `playing===true` and the count is hidden.

- [ ] **Step 6: Commit**

```bash
git add resonote.html
git commit -m "feat: configurable count-in before the performance starts"
```

---

### Task 6: Calibration & full verification pass (controller-driven, headless)

**Files:**
- Modify: `resonote.html` — bar layout/spacing polish only.

**Interfaces:** none new.

- [ ] **Step 1: Full headless run**

Drive the app in headless Chrome: set a multi-measure pattern, exercise count-in → play → pause → resume → rewind → each speed preset → exit. Capture an overlay screenshot showing the full bar (`◀  ⏸/▶  0.5× 0.75× 1× 1.25×  <bpm>  ✕ Exit`).

- [ ] **Step 2: Verify against the spec**

Confirm: count-in delays and shows the count; speed presets change `state.tempo` relative to `baseTempo` and re-sync the scroll; pause freezes and resume continues from the same step; ◀ snaps to a measure boundary; Exit restores the pattern tempo and closes; the plain editor ▶ Play still starts from step 0. Space toggles pause/play in the view.

- [ ] **Step 3: Polish + commit**

Adjust bar spacing/wrap and the count font size if needed for readability. Commit:

```bash
git add resonote.html
git commit -m "chore: calibrate performance transport bar + verify controls end-to-end"
```

---

## Self-review notes

- **Spec coverage:** `play(fromStep)` foundation (Task 1); pause/resume-from-position (Task 2); rewind previous-measure (Task 3); speed presets with live re-sync + tempo restore on exit (Task 4); configurable count-in with on-screen count (Task 5); bar layout + end-to-end verification (Task 6). All spec sections mapped.
- **Placeholder scan:** every code step contains real code; verification steps give concrete headless snippets and expected values.
- **Type consistency:** `play(fromStep)` (Task 1) is consumed by `performResume`/`performSeek`/`startPerformPlayback` (Tasks 2/3/5). `perform.pausedStep` set in Task 2, used in Tasks 3/5. `perform.baseTempo` set in Task 4's `enterPerform` addition and consumed by `setPerformSpeed`/`exitPerform`. `perform.countTimer` cleared in Task 4's `exitPerform`, set in Task 5's `runCountIn`. `performMoveStrip` (Task 3) reused by `enterPerform` (Task 5). Element ids (`performPrev`, `performPlay`, `perf-speed`, `performCount`, `countIn`, `performTempo`) are consistent across tasks.
```
