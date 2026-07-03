# Performance View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen performance view that, on ▶ Perform, hides the editor and shows only the handpan (lighting notes as they sound) and the notation as one long staff scrolling right→left under a fixed playhead.

**Architecture:** A hidden full-screen overlay (`#performOverlay`, same pattern as the print overlay) holds a large pan and a single-row notation strip built from the existing shared engine (`buildScoreModel` + `layoutScore` with a new `perRow` arg, reusing `measureSVG`). Playback reuses `play()`/`scheduler()`; a `requestAnimationFrame` loop derives the scroll position from the audio clock and translates the strip. `litPan()` is generalized to light both the editor pan and the performance pan.

**Tech Stack:** Single-file `resonote.html` (inline CSS + vanilla JS), SVG, Web Audio (existing). No build step. Served locally with `python3 -m http.server 8001`. Headless verification via `google-chrome` + `puppeteer-core` (already in the session scratchpad).

## Global Constraints

- Single file: all code stays in `resonote.html` (existing pattern). No new files, no modules.
- Presentation-only: the performance view never edits the pattern or instrument.
- Reuse the shared notation engine (`buildScoreModel`/`layoutScore`/`measureSVG`) and the existing playback (`play`/`scheduler`/`stop`) — do not duplicate layout or audio logic.
- Right hand = orange, left hand = blue (already enforced by the engine and CSS).
- Scroll position is derived from the same audio clock the scheduler uses (`ctx.currentTime`), so the playhead stays synced to what is heard.
- The performance pan reuses the exact pan markup (same `data-voice` attributes) so `litPan()` lights it with no special-casing.
- Verification: `node --check` on the extracted `<script>` for every task; Node logic assertions for the pure engine change; headless-Chrome screenshots (controller) for visual/interactive behavior. jsPDF/browser-only paths are not runnable in plain Node.

---

### Task 1: `layoutScore` gains an optional `perRow` argument

**Files:**
- Modify: `resonote.html` — `layoutScore` (the `const per=Math.min(SCORE.measPerRow, ...)` line)

**Interfaces:**
- Consumes: existing `layoutScore(model, contentW)`.
- Produces: `layoutScore(model, contentW, perRow)` — when `perRow` is given it overrides `SCORE.measPerRow`; omitting it is unchanged. Return shape is identical.

- [ ] **Step 1: Add the parameter**

Change the signature and the `per` computation:

```js
function layoutScore(model, contentW, perRow){
  const per=Math.min(perRow||SCORE.measPerRow, model.measures)||1;
```

(Only those two lines change; the rest of `layoutScore` is untouched.)

- [ ] **Step 2: Verify in Node (pure function)**

Extract `SCORE`, `buildScoreModel`, `layoutScore` into a temp file with stubs `orderOf=()=>['D','1','2','3','4','5','6','7','8','9']; printSym=v=>v; sheetName=()=>'T';`, then:

```js
state={instrument:{name:'X'},artist:'',marks:{},grid:{},measures:3,beats:4,sub:4,title:'T'};
const model=buildScoreModel(state);
const wrapped=layoutScore(model,760);              // default perRow (5)
const oneRow=layoutScore(model,3*220+2*SCORE.measGap,3);
console.assert(oneRow.rows.length===1,'perRow=3 should give a single row');
console.assert(oneRow.rows[0].measures.length===3,'single row holds all 3 measures');
console.assert(Math.abs(oneRow.measW-220)<0.01,'measW should be 220');
console.assert(wrapped.rows[0].measures.length===3,'default still works for 3 measures');
console.log('Task1 OK');
```

Expected: prints `Task1 OK`, no assertion failures. Also run `node --check` on the full extracted `<script>`.

- [ ] **Step 3: Commit**

```bash
git add resonote.html
git commit -m "feat: layoutScore optional perRow arg (single-row layout)"
```

---

### Task 2: Performance overlay shell + ▶ Perform button + enter/exit wiring

**Files:**
- Modify: `resonote.html` — transport markup (add Perform button near the Play button, ~line 184), overlay markup (after the `#printOverlay` block, ~line 257), `<style>` (add perform styles), script (add `perform` state, stubs, and enter/exit).

**Interfaces:**
- Consumes: `play()`, `stop()` (existing).
- Produces:
  - `let perform={active:false, raf:0, stripW:0, measureW:220, spm:16, stepW:0, oy:70, playheadX:0};`
  - `function renderPerformPan(){}` and `function renderPerformStrip(){}` — **empty stubs** (Tasks 3 and 4 replace the bodies).
  - `function enterPerform()` — renders pan+strip, shows `#performOverlay`, starts playback + loop.
  - `function exitPerform()` — stops playback + loop, hides the overlay.
  - `function startPerformLoop(){}` / `function stopPerformLoop(){}` — **stubs** (Task 5 fills them).

- [ ] **Step 1: Add the ▶ Perform button**

In the transport, right after the Play button (`<button class="btn primary" id="playBtn">▶ Play</button>`), add:

```html
          <button class="btn" id="performBtn">⤢ Perform</button>
```

- [ ] **Step 2: Add the overlay markup**

After the closing `</div>` of `#printOverlay` (before `<div class="toast" ...>`), add:

```html
<div class="perform-overlay" id="performOverlay" style="display:none">
  <div class="perform-bar">
    <button class="btn" id="performPlay">■ Stop</button>
    <span class="perform-tempo" id="performTempo"></span>
    <button class="btn" id="performExit">✕ Exit</button>
  </div>
  <div class="perform-pan-wrap"><svg class="perform-pan" id="performPan" viewBox="0 0 300 300"></svg></div>
  <div class="perform-stage" id="performStage">
    <div class="perform-playhead" id="performPlayhead"></div>
    <div class="perform-strip" id="performStrip"></div>
  </div>
</div>
```

- [ ] **Step 3: Add the styles**

In `<style>`, add:

```css
.perform-overlay{position:fixed;inset:0;background:#1b1f26;z-index:120;display:flex;flex-direction:column;overflow:hidden}
.perform-bar{display:flex;align-items:center;gap:14px;justify-content:flex-end;padding:12px 18px}
.perform-bar .btn{background:#2a303a;border-color:#3a424e;color:#eef1f5}
.perform-bar .btn:hover{background:#333b47}
.perform-tempo{margin-right:auto;color:#aab4c2;font-family:var(--mono);font-size:14px}
.perform-pan-wrap{display:flex;justify-content:center;align-items:center;flex:0 0 auto;padding:6px}
svg.perform-pan{width:min(38vh,340px);height:min(38vh,340px)}
.perform-stage{position:relative;flex:1 1 auto;overflow:hidden;margin-top:8px}
.perform-strip{position:absolute;top:0;left:0;will-change:transform}
.perform-strip svg{background:#fff;border-radius:8px}
.perform-playhead{position:absolute;top:8px;bottom:24px;width:2px;background:#E8971E;box-shadow:0 0 8px rgba(232,151,30,.8);z-index:2}
```

- [ ] **Step 4: Add state, stubs, and enter/exit**

Add near the playback section (after `function stop(){...}`):

```js
let perform={active:false, raf:0, stripW:0, measureW:220, spm:16, stepW:0, oy:70, playheadX:0};
function renderPerformPan(){}                 // Task 3 fills this
function renderPerformStrip(){}               // Task 4 fills this
function startPerformLoop(){}                 // Task 5 fills this
function stopPerformLoop(){}                  // Task 5 fills this
function enterPerform(){
  if(perform.active)return;
  renderPerformPan(); renderPerformStrip();
  document.getElementById('performTempo').textContent=state.tempo+' bpm';
  document.getElementById('performOverlay').style.display='flex';
  perform.active=true;
  const stage=document.getElementById('performStage');
  perform.playheadX=Math.round(stage.clientWidth*0.30);
  document.getElementById('performPlayhead').style.left=perform.playheadX+'px';
  if(!playing)play();
  startPerformLoop();
  document.getElementById('performPlay').textContent='■ Stop';
}
function exitPerform(){
  if(!perform.active)return;
  stopPerformLoop(); stop(); perform.active=false;
  document.getElementById('performOverlay').style.display='none';
}
```

- [ ] **Step 5: Wire the controls**

Add near the other button listeners (after the `printBtn`/`doPrint` listeners):

```js
document.getElementById('performBtn').addEventListener('click',()=>{resumeAudio();enterPerform();});
document.getElementById('performExit').addEventListener('click',exitPerform);
document.getElementById('performPlay').addEventListener('click',()=>{
  if(playing){stop();document.getElementById('performPlay').textContent='▶ Play';}
  else{play();startPerformLoop();document.getElementById('performPlay').textContent='■ Stop';}
});
```

And add Escape handling inside the existing top-level `document.addEventListener('keydown',...)` handler, as the FIRST lines of its callback:

```js
  if(e.key==='Escape'&&perform.active){exitPerform();return;}
```

- [ ] **Step 6: Verify**

Run `node --check` on the extracted `<script>`. Confirm by reading the diff: the button exists, the overlay markup + styles are present, `enterPerform`/`exitPerform` are defined, stubs exist, and the Escape guard is the first line of the keydown callback.
Report that interactive/visual confirmation (overlay opens, plays, Esc closes) is deferred to the controller's headless check.

- [ ] **Step 7: Commit**

```bash
git add resonote.html
git commit -m "feat: performance overlay shell, Perform button, enter/exit wiring"
```

---

### Task 3: Performance pan + `litPan()` generalization

**Files:**
- Modify: `resonote.html` — refactor `renderPan()` to use a shared markup builder, fill `renderPerformPan()`, generalize `litPan()`.

**Interfaces:**
- Consumes: `state.instrument`, `isSampled`, `state.showBottom`.
- Produces: `function panInnerSVG()` (returns the pan's inner SVG string), used by both `renderPan()` and `renderPerformPan()`. `litPan(v,hand)` lights all matching `[data-voice]`.

- [ ] **Step 1: Extract the pan markup builder**

In `renderPan()`, the function builds a string `h` (the `<circle>`/fields/ding/bottoms markup) and then does `svg.innerHTML=h; ...handlers...; instrName`. Move the markup-building into a new function and call it. Replace the body of `renderPan()` so that everything from `const svg=...` down to the line that sets `svg.innerHTML=h;` is restructured as:

```js
function panInnerSVG(){
  const cx=150,cy=140,R=92,tops=[],bots=[];
  state.instrument.fields.forEach((f,i)=>{(f.bottom?bots:tops).push({note:f.note,num:i+1,ang:f.ang,rad:f.rad});});
  let h=`<circle cx="${cx}" cy="${cy}" r="128" fill="var(--pan-fill)" stroke="#aab4c2" stroke-width="1.5"/><circle cx="${cx}" cy="${cy}" r="116" fill="none" stroke="#b4bdca" stroke-width="1"/>`;
  const drawField=(f,x,y)=>{h+=`<g class="field" data-voice="${f.num}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="17" fill="var(--pan-pod)" stroke="#c2cad6" stroke-width="1"/>
      ${isSampled(String(f.num))?`<circle cx="${(x+11).toFixed(1)}" cy="${(y-11).toFixed(1)}" r="3" fill="var(--teal)"/>`:''}
      <text class="num" x="${x.toFixed(1)}" y="${(y+4).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="600" fill="var(--text)" font-family="var(--mono)">${f.num}</text>
      <text class="pan-note-name" x="${x.toFixed(1)}" y="${(y+27).toFixed(1)}" text-anchor="middle">${f.note}</text></g>`;};
  const nums=tops.map(f=>f.num);
  const ring=nums.filter(x=>x%2===1).sort((a,b)=>a-b).concat(nums.filter(x=>x%2===0).sort((a,b)=>b-a));
  const N=ring.length||1;
  ring.forEach((num,j)=>{const f=tops.find(t=>t.num===num);const bta=j*2*Math.PI/N;
    drawField(f, cx+R*Math.sin(bta), cy+R*Math.cos(bta));});
  h+=`<g class="ding-hit" data-voice="D"><circle class="ding-face" cx="${cx}" cy="${cy}" r="30" fill="var(--pan-pod)" stroke="#c2cad6" stroke-width="1.5"/>
      <line x1="${cx-21}" y1="${cy}" x2="${cx+21}" y2="${cy}" stroke="#d3dae3"/><line x1="${cx}" y1="${cy-21}" x2="${cx}" y2="${cy+21}" stroke="#d3dae3"/>
      <text class="ding-label" x="${cx}" y="${cy-2}" text-anchor="middle" font-size="16" font-weight="700" fill="var(--ding)" font-family="var(--mono)">D</text>
      <text class="pan-note-name" x="${cx}" y="${cy+13}" text-anchor="middle">${state.instrument.ding}</text></g>`;
  if(bots.length && state.showBottom){
    let auto=0;
    bots.forEach(f=>{
      let ang=f.ang, rad=f.rad;
      if(ang==null){ ang=200 - auto*40; auto++; }
      if(rad==null) rad=84;
      const a=ang*Math.PI/180, x=cx+rad*Math.sin(a), y=cy+rad*Math.cos(a);
      h+=`<g class="field bottom" data-voice="${f.num}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="none" stroke="var(--teal)" stroke-width="1.5" stroke-dasharray="3 3"/>
        <text class="num" x="${x.toFixed(1)}" y="${(y+3.5).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--teal)" font-family="var(--mono)">${f.num}</text>
        <text class="pan-note-name" x="${x.toFixed(1)}" y="${(y+23).toFixed(1)}" text-anchor="middle" fill="var(--teal)" opacity="0.8">${f.note}</text></g>`;
    });
  }
  return h;
}
```

Then make `renderPan()`:

```js
function renderPan(){
  const svg=document.getElementById('pan');
  svg.innerHTML=panInnerSVG();
  svg.querySelectorAll('[data-voice]').forEach(el=>el.addEventListener('click',()=>{resumeAudio();const v=el.dataset.voice;playVoice(v,null,null);litPan(v);}));
  document.getElementById('instrName').innerHTML=`<b>${escapeHtml(state.instrument.name||'Custom')}</b> · ${meloVoices().length} notes`;
}
```

(This preserves `renderPan()`'s existing behavior exactly — same markup, handlers, and instrument name — just via the shared builder.)

- [ ] **Step 2: Fill `renderPerformPan()`**

Replace the stub:

```js
function renderPerformPan(){
  const svg=document.getElementById('performPan'); if(!svg)return;
  svg.innerHTML=panInnerSVG();
}
```

- [ ] **Step 3: Generalize `litPan()`**

Replace `litPan`:

```js
function litPan(v,hand){const c=hand==='L'?'lit-L':'lit';
  document.querySelectorAll(`[data-voice="${v}"]`).forEach(el=>{el.classList.add(c);setTimeout(()=>el.classList.remove(c),260);});}
```

(Previously it used `querySelector('#pan …')`; now it lights the same voice in both the editor pan and the performance pan.)

- [ ] **Step 4: Verify**

Run `node --check` on the extracted `<script>`. Confirm `renderPan()` still sets `#pan` innerHTML + attaches click handlers + sets instrName; `renderPerformPan()` sets `#performPan` innerHTML from the same builder; `litPan` uses `querySelectorAll`. Report that visual lighting across both pans is confirmed by the controller's headless screenshot.

- [ ] **Step 5: Commit**

```bash
git add resonote.html
git commit -m "feat: performance pan via shared markup builder; litPan lights both pans"
```

---

### Task 4: Notation strip (single-row SVG + playhead metrics)

**Files:**
- Modify: `resonote.html` — fill `renderPerformStrip()`.

**Interfaces:**
- Consumes: `buildScoreModel`, `layoutScore` (with `perRow`), `measureSVG`, `SCORE`, the `perform` state object.
- Produces: `renderPerformStrip()` builds the one-row SVG into `#performStrip` and records `perform.stripW`, `perform.spm`, `perform.stepW`, `perform.oy`.

- [ ] **Step 1: Fill `renderPerformStrip()`**

Replace the stub:

```js
function renderPerformStrip(){
  const host=document.getElementById('performStrip'); if(!host)return;
  const model=buildScoreModel(state);
  const per=Math.max(1,state.measures), MEASURE_W=perform.measureW;
  const contentW=per*MEASURE_W+(per-1)*SCORE.measGap;
  const lay=layoutScore(model, contentW, per);
  const oy=perform.oy;
  let body='';
  (lay.rows[0]?lay.rows[0].measures:[]).forEach(meas=>{body+=measureSVG(meas,oy);});
  const H=oy+SCORE.staffH+40;
  host.innerHTML=`<svg width="${contentW}" height="${H}" viewBox="0 0 ${contentW} ${H}">${body}</svg>`;
  host.style.transform='translateX('+perform.playheadX+'px)';   // start with position 0 at the playhead
  perform.stripW=contentW;
  perform.spm=model.beats*model.sub;
  perform.stepW=MEASURE_W/perform.spm;
}
```

- [ ] **Step 2: Verify**

Run `node --check`. Confirm the function calls `layoutScore(model, contentW, per)` with `per=state.measures` (single row), reuses `measureSVG` for each measure, sets `#performStrip` innerHTML to one `<svg>`, and records `stripW`/`spm`/`stepW`. Report that the rendered strip is confirmed visually by the controller's headless screenshot.

- [ ] **Step 3: Commit**

```bash
git add resonote.html
git commit -m "feat: single-row scrolling notation strip via shared engine"
```

---

### Task 5: Scroll animation loop synced to the audio clock

**Files:**
- Modify: `resonote.html` — add `playAnchor` capture in `play()`, fill `startPerformLoop()`/`stopPerformLoop()` and add `performPos()`/`performTick()`.

**Interfaces:**
- Consumes: `ctx.currentTime`, `stepDur()`, `totalSteps()`, `state.loop`, the `perform` object.
- Produces: `playAnchor` (audio time of step 0), a running `requestAnimationFrame` loop that translates `#performStrip` so the current position sits under the playhead.

- [ ] **Step 1: Capture the play anchor**

In `play()`, the line is `playing=true;curStep=0;nextTime=ctx.currentTime+.06;`. Add the anchor right after it:

```js
  playAnchor=nextTime;
```

And declare it with the other playback vars — change `let playing=false,curStep=0,nextTime=0,timer=null;` to:

```js
let playing=false,curStep=0,nextTime=0,timer=null,playAnchor=0;
```

- [ ] **Step 2: Fill the loop functions**

Replace the `startPerformLoop`/`stopPerformLoop` stubs and add helpers:

```js
function performPos(){                       // fractional step position from the audio clock
  if(!ctx)return 0;
  let pos=(ctx.currentTime-playAnchor)/stepDur();
  if(pos<0)pos=0;
  const tot=totalSteps()||1;
  return state.loop?(pos%tot):Math.min(pos,tot);
}
function performTick(){
  if(!perform.active){perform.raf=0;return;}
  const host=document.getElementById('performStrip');
  if(host){const x=performPos()*perform.stepW;
    host.style.transform='translateX('+(perform.playheadX - x)+'px)';}
  perform.raf=requestAnimationFrame(performTick);
}
function startPerformLoop(){if(!perform.raf)perform.raf=requestAnimationFrame(performTick);}
function stopPerformLoop(){if(perform.raf){cancelAnimationFrame(perform.raf);perform.raf=0;}}
```

- [ ] **Step 3: Verify**

Run `node --check`. Confirm `play()` sets `playAnchor=nextTime`, `performPos()` derives position from `ctx.currentTime`/`stepDur()` and wraps modulo `totalSteps()` when `state.loop`, and `performTick()` sets `#performStrip` `translateX(playheadX - x)` and reschedules only while `perform.active`. Report that smooth scroll + sync is confirmed by the controller's headless capture.

- [ ] **Step 4: Commit**

```bash
git add resonote.html
git commit -m "feat: audio-clock-synced scroll loop for the performance view"
```

---

### Task 6: Calibration & verification pass (controller-driven, headless capture)

**Files:**
- Modify: `resonote.html` — tune `perform.measureW`, playhead fraction, pan size, stage colors; optional note-at-playhead emphasis.

**Interfaces:** none new — adjusts constants/behavior from Tasks 2–5.

- [ ] **Step 1: Drive the app in headless Chrome**

Using `puppeteer-core` + `/usr/bin/google-chrome` (as in the PDF harness), load `http://localhost:8001/resonote.html`, set a multi-measure pattern with marks, click `#performBtn`, and capture `#performOverlay` screenshots at a few playback times (e.g. advance ~300ms, ~900ms) plus a full-overlay shot.

- [ ] **Step 2: Verify against the spec**

Confirm: only the pan + notation strip + control bar are visible; the playhead is fixed while the strip scrolls right→left; the note(s) under the playhead are lit on the performance pan (orange right / blue left); Loop wraps to the start; `✕ Exit` and `Esc` restore the editor unchanged (overlay hidden, `perform.active===false`, playback stopped).

- [ ] **Step 3: Tune constants and optionally emphasize the current note**

Adjust `perform.measureW` (scroll density), the `*0.30` playhead fraction, `svg.perform-pan` size, and stage/playhead colors for readability. Optionally add a subtle emphasis to the number(s) currently under the playhead (e.g. a brief scale/opacity bump) if it reads better; keep it cheap (skip if it complicates the loop).

- [ ] **Step 4: Re-verify and commit**

Re-run the headless capture; confirm the view matches the spec. Commit:

```bash
git add resonote.html
git commit -m "chore: calibrate performance view (sizing, playhead, scroll density)"
```

---

## Self-review notes

- **Spec coverage:** full-screen overlay hiding the editor (Task 2); pan lighting notes (Task 3 + reused `litPan`); one-row notation strip in the PDF/Notepan style (Task 1 `perRow` + Task 4); continuous scroll under a fixed playhead synced to the audio clock (Task 5); Perform button + Esc/Exit (Task 2); pan-on-top layout (Task 2 CSS); presentation-only / no editing (no editor wiring added); loop wrap (Task 5 `performPos`); verification via headless capture (Task 6). All spec sections mapped.
- **Placeholder scan:** every code step contains real code; stubs in Task 2 are explicitly replaced by named later tasks (not placeholders — sequenced deliverables). Verification steps give concrete commands/observables.
- **Type consistency:** the `perform` object fields (`active`, `raf`, `measureW`, `spm`, `stepW`, `oy`, `playheadX`, `stripW`) are introduced in Task 2 and consumed with the same names in Tasks 4–5. `panInnerSVG()` (Task 3) is consumed by `renderPan`/`renderPerformPan`. `layoutScore(model, contentW, perRow)` (Task 1) is called with `perRow` in Task 4. `playAnchor` (Task 5) is set in `play()` and read by `performPos()`. Element ids (`performOverlay`, `performPan`, `performStrip`, `performStage`, `performPlayhead`, `performPlay`, `performExit`, `performBtn`, `performTempo`) are defined in Task 2 and referenced identically later.
