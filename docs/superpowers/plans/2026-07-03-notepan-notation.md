# Notepan-style Notation & Light Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Resonote's exported PDF and on-screen UI reproduce the Notepan app — a two-page PDF (pan diagram + horizontal-staff notation with orange right-hand / blue left-hand numbers, section/tempo marks, footer), a light theme, and an annotation editor.

**Architecture:** One shared pure layout engine (`layoutScore()`) turns the grid + annotations into abstract draw-ops; two thin renderers (`renderScoreSVG` for the on-screen preview, `renderScorePDF` for jsPDF) consume the same ops so screen and PDF can't drift. Data-model additions (artist, per-measure marks) persist at pattern version 3 with v2 back-compat. Theme is a CSS-variable palette swap.

**Tech Stack:** Single-file `resonote.html` (inline CSS + vanilla JS), jsPDF 2.5.1 (already loaded via CDN), SVG for on-screen preview. No build step. Served locally with `python3 -m http.server 8001`.

## Global Constraints

- Single file: all code stays in `resonote.html` (existing pattern). No new module system, no bundler.
- Saved-pattern schema bumps to `v:3`; **v2 patterns must still load** (`artist` → `""`, `marks` → `{}`).
- Hand colors are fixed everywhere: **right hand = orange, left hand = blue.**
- Calibration colors (initial values, tune in Task 9 against the reference PDFs):
  orange `rgb(232,151,30)` / `#E8971E`, blue `rgb(74,128,192)` / `#4A80C0`,
  tick gray `rgb(150,150,150)` / `#969696`, barline/ink `rgb(20,20,20)` / `#141414`,
  pan fill blue-gray `#c3ccda`, pod white `#ffffff`, note-name blue `#3a5a80`, number gray `#8a97a5`.
- The shared engine is **pure** (no DOM, no globals): it takes explicit arguments and returns data. Both renderers and console tests call it directly.
- Reference PDFs are ground truth: `assets/patterns/Happy Birthday - Popular.pdf` and `assets/patterns/RoelsCollection.pdf`.
- Verification runs in the browser at `http://localhost:8001/resonote.html`; pure-logic checks are pasted into the DevTools console.

---

### Task 1: Data model — artist + per-measure marks + v3 persistence

**Files:**
- Modify: `resonote.html` (state init ~line 315-318, `snapshot()` ~482, `loadPattern()` ~500-505)

**Interfaces:**
- Produces: `state.artist` (string), `state.marks` (object `{ [measureIndex:number]: {part?:string, section?:string, tempo?:number, expr?:string} }`), `snapshot()` including both, `loadPattern(p)` restoring both with defaults.

- [ ] **Step 1: Add fields to state init**

In the `let state={...}` object, add `artist` and `marks`:

```js
let state={
  instrument:{name:"D Kurd 10+3",ding:"D3",fields:mk(["A3","Bb3","C4","D4","E4","F4","G4","A4","C5"]).concat([b("F3",65,84),b("G3",293,84),b("D5",240,58)])},
  artist:"", marks:{},
  tempo:90,beats:4,sub:4,measures:1,loop:true,met:false,showBottom:true,grid:{}
};
```

- [ ] **Step 2: Serialize in snapshot()**

Change `snapshot(name)` to include artist + marks and bump version:

```js
function snapshot(name){return{name,artist:state.artist||"",instrument:JSON.parse(JSON.stringify(state.instrument)),tempo:state.tempo,beats:state.beats,sub:state.sub,measures:state.measures,marks:JSON.parse(JSON.stringify(state.marks||{})),grid:JSON.parse(JSON.stringify(state.grid)),ts:Date.now(),v:3};}
```

- [ ] **Step 3: Restore in loadPattern() with v2 back-compat**

In `loadPattern(p)`, after the instrument lines, add artist + marks with defaults:

```js
  state.artist=p.artist||"";
  state.marks=p.marks?JSON.parse(JSON.stringify(p.marks)):{};
```

- [ ] **Step 4: Verify roundtrip in the console**

Reload `http://localhost:8001/resonote.html`, open DevTools console, run:

```js
state.artist="Test Artist"; state.marks={0:{part:"Part A",tempo:120}};
const snap=snapshot("rt"); console.assert(snap.v===3&&snap.artist==="Test Artist"&&snap.marks[0].tempo===120,"snapshot fail");
state.artist=""; state.marks={}; loadPattern(snap);
console.assert(state.artist==="Test Artist"&&state.marks[0].part==="Part A","load fail");
loadPattern({name:"old",instrument:state.instrument,tempo:90,beats:4,sub:4,measures:1,grid:{}});
console.assert(state.artist===""&&Object.keys(state.marks).length===0,"v2 back-compat fail");
console.log("Task1 OK");
```

Expected: console prints `Task1 OK` with no assertion errors.

- [ ] **Step 5: Commit**

```bash
git add resonote.html
git commit -m "feat: add artist + per-measure marks to data model (pattern v3)"
```

---

### Task 2: Light Notepan theme (CSS variable swap)

**Files:**
- Modify: `resonote.html` `:root` block (~line 10-19), `body` background (~21), print-sheet colors (~120-135)

**Interfaces:**
- Produces: a light color palette applied through existing CSS variables. No markup changes.

- [ ] **Step 1: Replace the `:root` palette**

Swap the dark steel variables for the light Notepan palette (keep variable names so existing rules keep working):

```css
:root{
  --steel-0:#ffffff; --steel-1:#f7f8fa; --steel-2:#eef1f5; --steel-3:#e3e8ee;
  --line:#c8d0da; --line-soft:#dde3ea; --text:#1c2430; --muted:#6b7684;
  --bronze:#E8971E; --bronze-line:rgba(232,151,30,.5); --ding:#b9832a;
  --teal:#3a6ea5; --teal-dim:rgba(58,110,165,.12); --danger:#c0453a;
  --hand-left:#4A80C0;  --hand-left-dim:rgba(74,128,192,.16);
  --hand-right:#E8971E; --hand-ring:rgba(232,151,30,.55);
  --pan-fill:#c3ccda; --pan-pod:#ffffff; --pan-note:#3a5a80; --pan-num:#8a97a5;
  --radius:12px; --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
```

- [ ] **Step 2: Lighten the body background**

Replace the `body` background line:

```css
body{background:radial-gradient(1200px 600px at 50% -10%, #ffffff 0%, #eef1f5 60%) fixed;
  color:var(--text); font-family:var(--sans); line-height:1.5; -webkit-font-smoothing:antialiased; padding:clamp(14px,3vw,32px);}
```

- [ ] **Step 3: Fix the H1 gradient for light background**

Replace the `h1{...}` gradient (dark-on-dark → ink):

```css
h1{font-size:clamp(28px,5vw,42px);margin:0;font-weight:650;letter-spacing:-.02em;color:var(--text)}
```

- [ ] **Step 4: Verify visually**

Reload the app. Expected: background is white/light gray, panels are pale, text is dark and readable, header title is dark ink. No dark steel panels remain.

- [ ] **Step 5: Commit**

```bash
git add resonote.html
git commit -m "feat: light Notepan theme via CSS variable swap"
```

---

### Task 3: Hand colors — orange (right) / blue (left) everywhere

**Files:**
- Modify: `resonote.html` grid cell styles (~75-77), pan lit styles (~38-43), readout (~82), legend markup (~203-205), pan number fills in `renderPan()` (~350-378)

**Interfaces:**
- Consumes: `--hand-right` (orange), `--hand-left` (blue) from Task 2.
- Produces: right-hand marks render orange, left-hand blue, in grid, pan lit-state, readout, legend.

- [ ] **Step 1: Grid cells — orange R text-visible fill, blue L**

Replace the `.cellbox.on-R` / `.cellbox.on-L` rules:

```css
.cellbox.on-R{background:var(--hand-right);box-shadow:inset 0 0 0 1.5px var(--hand-ring)}
.cellbox.on-L{background:var(--hand-left);box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}
```

- [ ] **Step 2: Pan lit-states use orange for right, blue for left**

Replace the `.field.lit` / `.field.lit-L` and ding equivalents:

```css
.field.lit circle{fill:var(--hand-right);stroke:var(--hand-right)} .field.lit text.num{fill:#3a2400}
.field.lit-L circle{fill:var(--hand-left);stroke:var(--hand-left)} .field.lit-L text.num{fill:#04203f}
.ding-hit.lit .ding-face{fill:var(--hand-right)} .ding-hit.lit .ding-label{fill:#3a2400}
.ding-hit.lit-L .ding-face{fill:var(--hand-left)} .ding-hit.lit-L .ding-label{fill:#04203f}
```

- [ ] **Step 3: Readout — right default ink, left blue**

Replace the `.readout .lft` rule so left is blue and add a right-hand color note (right stays default `--text`, but to echo Notepan make right orange):

```css
.readout .rest{color:#aab3bd} .readout .bar{color:var(--bronze);padding:0 4px}
.readout .lft{color:var(--hand-left)} .readout .rgt{color:var(--hand-right)}
```

Then in `renderReadout()` wrap right-hand symbols with `class="rgt"`. Replace the map line:

```js
    out+=keys.map(v=>{const sym=isPerc(v)?PERC.find(p=>p.id===v).label:v;return st[v]==='L'?`<span class="lft">${sym}</span>`:`<span class="rgt">${sym}</span>`;}).join('+')+' ';
```

- [ ] **Step 4: Legend swatches match**

In the legend markup, the left swatch already uses `--hand-left`; confirm the right swatch uses `--hand-right` (orange) with the ring. Replace the two swatch spans:

```html
          <span class="swatch" style="background:var(--hand-left)"></span>left hand ·
          <span class="swatch" style="background:var(--hand-right);box-shadow:inset 0 0 0 1.5px var(--hand-ring)"></span>right hand
```

- [ ] **Step 5: Verify visually**

Reload. Tap a grid cell once (right) → orange; twice (left) → blue. Tap the same note in the readout area — right symbols orange, left blue. Play and watch the pan light orange for right, blue for left.

- [ ] **Step 6: Commit**

```bash
git add resonote.html
git commit -m "feat: orange right-hand / blue left-hand across grid, pan, readout, legend"
```

---

### Task 4: Shared notation layout engine `layoutScore()`

**Files:**
- Modify: `resonote.html` — add a new `/* ===== SCORE ENGINE ===== */` section before the printable-sheet section (~line 577)

**Interfaces:**
- Consumes: `printSym(v)`, `orderOf()`, `isPerc(v)` (existing globals); `state` fields passed in explicitly via a `score` argument (kept pure).
- Produces:
  - `SCORE` constant (metrics).
  - `buildScoreModel(state)` → `{title, artist, scale, tempo, beats, sub, measures, marks, cells}` where `cells[m]` is an array (length `beats*sub`) of `{R:[sym...], L:[sym...]}`.
  - `layoutScore(model, contentWidth)` → `{rows:[{measures:[{m, x, w, ticks:[{x,tall}], barX, numbers:[{x,y,sym,role}], part, section, tempo, expr}], y}], footer}` in abstract units (points). `role` is `'R'|'L'`.

- [ ] **Step 1: Add metric constants and `buildScoreModel`**

Insert:

```js
/* ===== SCORE ENGINE (shared by SVG preview + PDF) ===== */
const SCORE={
  measGap:14, rowGap:34, measPerRow:5,
  staffH:44, half:22,            // centerline at +half from staff top
  barW:1.4, tickTall:16, tickShort:9, tickGray:[150,150,150], ink:[20,20,20],
  numFont:11, numStep:12,        // vertical stack step for stacked same-hand notes
  colorR:[232,151,30], colorL:[74,128,192],
  measNumFont:8, measNumGray:[150,150,150]
};
function buildScoreModel(st){
  const spm=st.beats*st.sub, order=orderOf(), cells=[];
  for(let m=0;m<st.measures;m++){
    const arr=[];
    for(let k=0;k<spm;k++){
      const s=m*spm+k, g=st.grid[s]||{};
      const R=order.filter(v=>g[v]==='R').map(printSym);
      const L=order.filter(v=>g[v]==='L').map(printSym);
      arr.push({R,L});
    }
    cells.push(arr);
  }
  return {title:(sheetName()), artist:st.artist||"", scale:st.instrument.name||"Custom",
    tempo:st.tempo, beats:st.beats, sub:st.sub, measures:st.measures,
    marks:st.marks||{}, cells};
}
```

- [ ] **Step 2: Add `layoutScore`**

```js
function layoutScore(model, contentW){
  const per=Math.min(SCORE.measPerRow, model.measures)||1;
  const measW=(contentW-(per-1)*SCORE.measGap)/per;
  const spm=model.beats*model.sub, colW=measW/spm;
  const rows=[]; let cur=null;
  for(let m=0;m<model.measures;m++){
    if(m%per===0){cur={measures:[],y:0}; rows.push(cur);}
    const x0=(m%per)*(measW+SCORE.measGap);
    const ticks=[];
    for(let k=0;k<spm;k++){ticks.push({x:x0+k*colW, tall:k%model.sub===0});}
    const numbers=[];
    model.cells[m].forEach((cell,k)=>{
      const cx=x0+k*colW+colW/2;
      cell.R.forEach((sym,i)=>numbers.push({x:cx, y:SCORE.half-8-i*SCORE.numStep, sym, role:'R'}));
      cell.L.forEach((sym,i)=>numbers.push({x:cx, y:SCORE.half+8+i*SCORE.numStep, sym, role:'L'}));
    });
    const mk=model.marks[m]||{};
    cur.measures.push({m:m+1, x:x0, w:measW, barX:x0, ticks, numbers,
      part:mk.part||null, section:mk.section||null, tempo:mk.tempo||null, expr:mk.expr||null});
  }
  const footer=`${model.title}${model.artist?' - '+model.artist:''} | ${model.scale}`;
  return {rows, footer, measW, spm};
}
```

- [ ] **Step 3: Verify engine output in the console**

Reload, then in console:

```js
state.grid={0:{'D':'R'},4:{'3':'R'},6:{'5':'L'}}; state.measures=1; state.beats=4; state.sub=4;
const model=buildScoreModel(state); const lay=layoutScore(model,515);
console.assert(model.cells[0][0].R[0]==='D',"cell0 R should be D");
console.assert(model.cells[0][6].L[0]==='5',"cell6 L should be 5");
const meas=lay.rows[0].measures[0];
const dNum=meas.numbers.find(n=>n.sym==='D');
console.assert(dNum.role==='R'&&dNum.y<SCORE.half,"D should be right/above centerline");
const fiveNum=meas.numbers.find(n=>n.sym==='5');
console.assert(fiveNum.role==='L'&&fiveNum.y>SCORE.half,"5 should be left/below centerline");
console.assert(meas.ticks[0].tall&&!meas.ticks[1].tall,"beat tick tall, sub tick short");
console.log("Task4 OK", lay.footer);
```

Expected: `Task4 OK ... | D Kurd 10+3` with no assertion errors.

- [ ] **Step 4: Commit**

```bash
git add resonote.html
git commit -m "feat: shared pure notation layout engine (buildScoreModel + layoutScore)"
```

---

### Task 5: On-screen SVG renderer `renderScoreSVG()` (replaces red/black print sheet)

**Files:**
- Modify: `resonote.html` — replace `renderPrintSheet()` (~581-607) to render the shared score; update `.print-sheet` container styling as needed.

**Interfaces:**
- Consumes: `buildScoreModel`, `layoutScore`, `SCORE`.
- Produces: `renderScoreSVG()` populating `#printSheet` with an SVG score (title, artist, tempo, measures with orange/blue numbers, section/tempo marks, footer). Preserves the element id `printSheet` so existing open/close wiring works.

- [ ] **Step 1: Implement `renderScoreSVG` and repoint `renderPrintSheet`**

Replace `renderPrintSheet()` with:

```js
function scoreSvgHead(model,W){
  let h=`<text x="${W/2}" y="34" text-anchor="middle" font-family="var(--sans)" font-size="22" fill="#141414">${escapeHtml(model.title)}</text>`;
  if(model.artist)h+=`<text x="${W/2}" y="56" text-anchor="middle" font-family="var(--sans)" font-size="14" fill="#555">${escapeHtml(model.artist)}</text>`;
  h+=`<text x="0" y="92" font-family="var(--sans)" font-size="12" fill="#141414">&#9833; = ${model.tempo}</text>`;
  return h;
}
function measureSVG(meas,oy){
  const top=oy, mid=oy+SCORE.half, bot=oy+SCORE.staffH, C=SCORE.tickGray;
  let h=`<line x1="${meas.x}" y1="${top}" x2="${meas.x}" y2="${bot}" stroke="rgb(20,20,20)" stroke-width="${SCORE.barW}"/>`;
  h+=`<line x1="${meas.x}" y1="${mid}" x2="${meas.x+meas.w}" y2="${mid}" stroke="rgb(${C})" stroke-width="0.6"/>`;
  meas.ticks.forEach((t,i)=>{if(i===0)return;const th=t.tall?SCORE.tickTall:SCORE.tickShort;
    h+=`<line x1="${t.x}" y1="${mid-th/2}" x2="${t.x}" y2="${mid+th/2}" stroke="rgb(${C})" stroke-width="0.6"/>`;});
  h+=`<text x="${meas.x+2}" y="${top-3}" font-family="var(--sans)" font-size="${SCORE.measNumFont}" fill="rgb(${SCORE.measNumGray})">${meas.m}</text>`;
  if(meas.part)h+=`<g><rect x="${meas.x}" y="${top-30}" width="${8+meas.part.length*7}" height="18" fill="none" stroke="#141414" stroke-width="1"/><text x="${meas.x+4}" y="${top-17}" font-family="var(--sans)" font-size="11" fill="#141414">${escapeHtml(meas.part)}</text></g>`;
  if(meas.section)h+=`<text x="${meas.x+meas.w/2}" y="${top-16}" text-anchor="middle" font-family="var(--sans)" font-size="11" fill="#141414">${escapeHtml(meas.section)}</text>`;
  if(meas.tempo)h+=`<text x="${meas.x}" y="${top-3}" font-family="var(--sans)" font-size="11" fill="#141414">&#9833; = ${meas.tempo}</text>`;
  if(meas.expr)h+=`<text x="${meas.x}" y="${bot+12}" font-family="var(--sans)" font-size="10" font-style="italic" fill="#555">${escapeHtml(meas.expr)}</text>`;
  meas.numbers.forEach(n=>{const col=n.role==='R'?`rgb(${SCORE.colorR})`:`rgb(${SCORE.colorL})`;
    h+=`<text x="${n.x}" y="${oy+n.y}" text-anchor="middle" font-family="var(--mono)" font-size="${SCORE.numFont}" fill="${col}">${escapeHtml(n.sym)}</text>`;});
  return h;
}
function renderScoreSVG(){
  const sheet=document.getElementById('printSheet');if(!sheet)return;
  const W=760, model=buildScoreModel(state), lay=layoutScore(model,W);
  let y=120; let body=scoreSvgHead(model,W);
  lay.rows.forEach(row=>{row.measures.forEach(meas=>{body+=measureSVG(meas,y);});
    y+=SCORE.staffH+SCORE.rowGap;});
  body+=`<text x="${W/2}" y="${y+10}" text-anchor="middle" font-family="var(--sans)" font-size="11" fill="#555">${escapeHtml(lay.footer)}  1/1</text>`;
  sheet.innerHTML=`<svg width="${W}" height="${y+30}" viewBox="0 0 ${W} ${y+30}" style="background:#fff;max-width:100%">${body}</svg>`;
}
const renderPrintSheet=renderScoreSVG;
```

Note: measure x-coordinates from `layoutScore` are row-relative; `measureSVG` uses them as-is since each row is drawn at its own `y`. Left content margin is 0 inside the SVG; the `.print-sheet` padding provides the page margin.

- [ ] **Step 2: Ensure `printSheet` renders SVG cleanly**

Confirm `.print-sheet` has a white background and adequate padding (existing `padding:34px 40px` is fine). No red/black CSS is used anymore; leave the old `.ps-*` rules in place (harmless) or delete them — deletion optional.

- [ ] **Step 3: Verify visually against the reference**

Reload. Set a few grid cells (mix R and L across measures), click **Printable sheet**. Expected: preview shows horizontal staff segments with a barline, centerline, beat/subdivision ticks, measure numbers, orange numbers above the line and blue below — matching the Notepan notation style in `assets/patterns/Happy Birthday - Popular.pdf` page 2.

- [ ] **Step 4: Commit**

```bash
git add resonote.html
git commit -m "feat: on-screen SVG score preview via shared engine (replaces red/black sheet)"
```

---

### Task 6: PDF page 1 — pan diagram (light)

**Files:**
- Modify: `resonote.html` — add `pdfPanPage(doc)` and call it first in `buildPDF()` (~613)

**Interfaces:**
- Consumes: `state.instrument`, the ring-ordering logic from `renderPan()`, jsPDF `doc`.
- Produces: `pdfPanPage(doc, model)` drawing the title/artist, blue-gray pan, white pods (note name blue + number gray), center ding, and centered scale name.

- [ ] **Step 1: Implement `pdfPanPage`**

```js
function pdfPanPage(doc,model){
  const PW=595, cx=PW/2, cy=470, R=150;
  doc.setFont('helvetica','bold');doc.setFontSize(20);doc.setTextColor(20,20,20);
  doc.text(model.title,cx,70,{align:'center'});
  if(model.artist){doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(40,40,40);doc.text(model.artist,cx,94,{align:'center'});}
  doc.setFillColor(195,204,218);doc.circle(cx,cy,R,'F');            // pan blue-gray
  const tops=[],bots=[];
  state.instrument.fields.forEach((f,i)=>{(f.bottom?bots:tops).push({note:f.note,num:i+1});});
  const nums=tops.map(f=>f.num);
  const ring=nums.filter(x=>x%2===1).sort((a,b)=>a-b).concat(nums.filter(x=>x%2===0).sort((a,b)=>b-a));
  const N=ring.length||1, rr=R*0.62;
  const pod=(x,y,rad,note,num,ding)=>{
    doc.setFillColor(255,255,255);doc.circle(x,y,rad,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(ding?13:11);doc.setTextColor(58,90,128);
    doc.text(String(note),x,y-2,{align:'center'});
    doc.setFontSize(ding?12:10);doc.setTextColor(138,151,165);
    doc.text(String(num),x,y+11,{align:'center'});
  };
  ring.forEach((num,j)=>{const f=tops.find(t=>t.num===num);const a=j*2*Math.PI/N;
    pod(cx+rr*Math.sin(a), cy-rr*Math.cos(a), 26, f.note, f.num, false);});
  pod(cx,cy,34,state.instrument.ding,'D',true);
  doc.setFont('helvetica','normal');doc.setFontSize(13);doc.setTextColor(20,20,20);
  doc.text(model.scale,cx,cy+R+70,{align:'center'});
}
```

- [ ] **Step 2: Call it first in `buildPDF`**

At the top of `buildPDF()`, after creating `doc`, build the model and draw page 1, then add a page for notation:

```js
  const model=buildScoreModel(state);
  pdfPanPage(doc,model);
  doc.addPage();
```

(Leave the rest of `buildPDF` for now; Task 7 replaces the notation body.)

- [ ] **Step 3: Verify against reference page 1**

Reload, open Printable sheet, click **Save as PDF**. Open the PDF; page 1 should show title/artist, a blue-gray pan with white pods (note name blue, number gray), center ding, and the scale name centered below — matching page 1 of `assets/patterns/Happy Birthday - Popular.pdf`.

- [ ] **Step 4: Commit**

```bash
git add resonote.html
git commit -m "feat: PDF page 1 pan diagram (light Notepan style)"
```

---

### Task 7: PDF notation pages `renderScorePDF()` + pagination + footer

**Files:**
- Modify: `resonote.html` — replace the notation body of `buildPDF()` (the measure-drawing loop ~627-651 and legend ~653-656) with a shared-engine renderer.

**Interfaces:**
- Consumes: `layoutScore`, `SCORE`, jsPDF `doc`, `model` from Task 6.
- Produces: notation rendered from the same ops as the SVG, paginated, with `Title - Artist | Scale   p/total` footers.

- [ ] **Step 1: Replace the notation drawing in `buildPDF`**

After `doc.addPage()` from Task 6, replace the old column-drawing loop with:

```js
  const M=40, PW=595, PH=842, contentW=PW-2*M;
  const lay=layoutScore(model,contentW);
  // paginate rows by vertical fit
  const rowH=SCORE.staffH+SCORE.rowGap;
  let pageRows=[], pages=[[]];
  lay.rows.forEach(r=>{pages[pages.length-1].push(r);});
  // repartition: start new page when exceeding usable height
  pages=[[]]; let yUsed=110;
  lay.rows.forEach(row=>{
    if(yUsed+rowH>PH-70){pages.push([]);yUsed=90;}
    pages[pages.length-1].push({row,y:yUsed});yUsed+=rowH;
  });
  const total=pages.length;
  const setInk=c=>doc.setTextColor(c[0],c[1],c[2]);
  pages.forEach((pageRows,pi)=>{
    if(pi>0)doc.addPage();
    // header on first notation page
    if(pi===0){
      doc.setFont('helvetica','bold');doc.setFontSize(18);setInk([20,20,20]);
      doc.text(model.title,PW/2,54,{align:'center'});
      if(model.artist){doc.setFont('helvetica','normal');doc.setFontSize(12);setInk([70,70,70]);doc.text(model.artist,PW/2,72,{align:'center'});}
      doc.setFont('helvetica','normal');doc.setFontSize(11);setInk([20,20,20]);
      doc.text('♩ = '+model.tempo,M,96);
    }
    pageRows.forEach(({row,y})=>{
      row.measures.forEach(meas=>{
        const ax=M+meas.x, top=y, mid=y+SCORE.half, bot=y+SCORE.staffH;
        doc.setDrawColor(20,20,20);doc.setLineWidth(SCORE.barW);
        doc.line(ax,top,ax,bot);
        doc.setDrawColor(150,150,150);doc.setLineWidth(0.5);
        doc.line(ax,mid,ax+meas.w,mid);
        meas.ticks.forEach((t,i)=>{if(i===0)return;const th=t.tall?SCORE.tickTall:SCORE.tickShort;
          doc.line(M+t.x,mid-th/2,M+t.x,mid+th/2);});
        doc.setFont('helvetica','normal');doc.setFontSize(SCORE.measNumFont);setInk(SCORE.measNumGray);
        doc.text(String(meas.m),ax+2,top-3);
        if(meas.part){doc.setDrawColor(20,20,20);doc.setLineWidth(0.8);
          const w=8+meas.part.length*6;doc.rect(ax,top-30,w,16);
          doc.setFontSize(11);setInk([20,20,20]);doc.text(meas.part,ax+4,top-19);}
        if(meas.section){doc.setFontSize(11);setInk([20,20,20]);doc.text(meas.section,ax+meas.w/2,top-17,{align:'center'});}
        if(meas.tempo){doc.setFontSize(11);setInk([20,20,20]);doc.text('♩ = '+meas.tempo,ax,top-3);}
        if(meas.expr){doc.setFontSize(10);doc.setFont('helvetica','italic');setInk([90,90,90]);doc.text(meas.expr,ax,bot+11);doc.setFont('helvetica','normal');}
        meas.numbers.forEach(n=>{const c=n.role==='R'?SCORE.colorR:SCORE.colorL;
          doc.setFont('courier','normal');doc.setFontSize(SCORE.numFont);setInk(c);
          doc.text(String(n.sym),M+n.x,y+n.y,{align:'center'});});
      });
    });
    doc.setFont('helvetica','normal');doc.setFontSize(9);setInk([90,90,90]);
    doc.text(`${lay.footer}`,PW/2,PH-30,{align:'center'});
    doc.text(`${pi+1}/${total}`,PW-M,PH-30,{align:'right'});
  });
  doc.save(sheetName().replace(/[^a-z0-9]+/gi,'_')+'.pdf');
  return true;
```

Delete the now-unused old drawing loop and legend text between `doc.addPage()` and this block, and the trailing old `doc.save(...)` / `return true`.

- [ ] **Step 2: Verify multi-page pagination + footer**

Reload. Build a pattern with many measures (use ＋ to add ~12 measures, scatter notes). Save as PDF. Expected: page 1 = pan; following pages = notation rows, ~5 measures per row, orange-above / blue-below, each page footed with `Title - Artist | Scale` centered and `p/total` at the right — matching `assets/patterns/RoelsCollection.pdf`.

- [ ] **Step 3: Commit**

```bash
git add resonote.html
git commit -m "feat: PDF notation pages via shared engine, paginated with footer"
```

---

### Task 8: Annotation editor UI ("Score details" panel)

**Files:**
- Modify: `resonote.html` — add a panel in the right column (after the Pattern panel, ~198) and wiring in the UI script section.

**Interfaces:**
- Consumes: `state.artist`, `state.marks`, `renderScoreSVG`, `renderReadout`.
- Produces: an Artist input + per-measure controls that write `state.marks[m]` and refresh the preview.

- [ ] **Step 1: Add the panel markup**

Insert after the Pattern panel's closing `</div>`:

```html
      <div class="panel">
        <h2>Score details</h2>
        <div class="row"><input class="txt" id="artistInput" placeholder="Artist / subtitle" maxlength="60" /></div>
        <div id="marksEditor" class="marks-editor"></div>
      </div>
```

- [ ] **Step 2: Add minimal styles**

In `<style>`, add:

```css
.marks-editor{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.mark-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.mark-row .mlab{font-family:var(--mono);font-size:11px;color:var(--muted);min-width:74px}
.mark-row input{background:var(--steel-2);border:1px solid var(--line);border-radius:7px;padding:5px 7px;font-size:12px;color:var(--text)}
.mark-row input.mpart{width:74px}.mark-row input.msec{width:74px}.mark-row input.mtempo{width:56px}.mark-row input.mexpr{width:84px}
```

- [ ] **Step 3: Render + wire the editor**

Add:

```js
function renderMarksEditor(){
  const wrap=document.getElementById('marksEditor');if(!wrap)return;
  let h='';
  for(let m=0;m<state.measures;m++){const k=state.marks[m]||{};
    h+=`<div class="mark-row"><span class="mlab">Measure ${m+1}</span>`+
      `<input class="mpart" data-m="${m}" data-f="part" placeholder="Part" value="${escapeAttr(k.part||'')}"/>`+
      `<input class="msec" data-m="${m}" data-f="section" placeholder="Section" value="${escapeAttr(k.section||'')}"/>`+
      `<input class="mtempo" data-m="${m}" data-f="tempo" placeholder="bpm" value="${k.tempo||''}"/>`+
      `<input class="mexpr" data-m="${m}" data-f="expr" placeholder="rall." value="${escapeAttr(k.expr||'')}"/></div>`;
  }
  wrap.innerHTML=h;
  wrap.querySelectorAll('input[data-m]').forEach(inp=>inp.addEventListener('input',e=>{
    const m=+e.target.dataset.m,f=e.target.dataset.f,val=e.target.value;
    const mk=state.marks[m]||(state.marks[m]={});
    if(f==='tempo'){if(val)mk.tempo=+val;else delete mk.tempo;}else{if(val)mk[f]=val;else delete mk[f];}
    if(!Object.keys(mk).length)delete state.marks[m];
  }));
}
document.getElementById('artistInput').addEventListener('input',e=>{state.artist=e.target.value;});
```

- [ ] **Step 4: Keep the editor synced with measures/artist**

In `renderAll()`, add `renderMarksEditor();` and set the artist field. Replace `renderAll`:

```js
function renderAll(){renderPan();renderGrid();renderFieldEditor();renderMarksEditor();
  const ai=document.getElementById('artistInput');if(ai)ai.value=state.artist||'';}
```

Also call `renderMarksEditor()` in the measures ＋/− handlers (after `renderGrid()`), and in `syncControls()` set `artistInput` value.

- [ ] **Step 5: Verify**

Reload. In Score details, set Artist, and for Measure 1 set Part `Part A`, Section `A - 1`, bpm `120`, expr `rall.`. Open Printable sheet: the boxed `Part A`, centered `A - 1`, `♩ = 120`, and italic `rall.` appear on measure 1; the artist appears as subtitle. Save as PDF and confirm the same.

- [ ] **Step 6: Commit**

```bash
git add resonote.html
git commit -m "feat: Score details panel — artist + per-measure section/tempo/expression marks"
```

---

### Task 9: Calibration & fidelity pass against the reference PDFs

**Files:**
- Modify: `resonote.html` — tune `SCORE` constants and `pdfPanPage` metrics only.

**Interfaces:** none new — adjusts constants used by Tasks 4-7.

- [ ] **Step 1: Recreate the reference pattern**

Reload. Set instrument preset to a D Kurd 9 (or edit fields to match `A3,Bb3,C4,D4,E4,F4,G4,A4,C5` with ding `D3`), name it `Happy Birthday`, artist `Popular`, and enter enough of the opening measures from `assets/patterns/Happy Birthday - Popular.pdf` (orange = right, blue = left) to compare layout.

- [ ] **Step 2: Generate and diff**

Save as PDF. Open the generated PDF beside `assets/patterns/Happy Birthday - Popular.pdf`. Compare: pan pod sizes/positions and colors (page 1); measure width, tick heights, number size/weight, orange/blue hues, measure-number placement, footer position (page 2).

- [ ] **Step 3: Tune constants**

Adjust in `SCORE` and `pdfPanPage`: `measPerRow`, `staffH`, `half`, `tickTall`, `tickShort`, `numFont`, `numStep`, `colorR`, `colorL`, `tickGray`, and pan `R`/`rr`/pod radii — until the generated output visually matches the reference. Sample exact orange/blue from the reference (e.g. via a color picker on the PDF) and set `colorR`/`colorL` accordingly; mirror the same hex into the `--hand-right`/`--hand-left` CSS variables so screen and print agree.

- [ ] **Step 4: Re-verify screen + PDF together**

Reload, confirm the on-screen preview and the PDF still match each other (shared engine) and both match the reference.

- [ ] **Step 5: Commit**

```bash
git add resonote.html
git commit -m "chore: calibrate score metrics and colors to Notepan reference PDFs"
```

---

## Self-review notes

- **Spec coverage:** data model (Task 1), light theme (Task 2), orange/blue hands (Task 3), shared engine (Task 4), on-screen preview (Task 5), PDF page 1 pan (Task 6), PDF notation + pagination + footer (Task 7), annotation editor (Task 8), fidelity calibration + Happy-Birthday diff test (Task 9). All spec sections mapped.
- **Placeholder scan:** every code step contains real code; verification steps give exact console snippets / observable expectations. Calibration values are concrete initial constants, explicitly tuned in Task 9 (not a placeholder — a documented refinement step).
- **Type consistency:** `buildScoreModel(st)` → model with `cells`, consumed by `layoutScore(model,contentW)` → `{rows,footer,measW,spm}`, consumed by `renderScoreSVG` (Task 5) and the `buildPDF` body (Task 7); `pdfPanPage(doc,model)` (Task 6) uses the same `model`. `SCORE` fields referenced identically across tasks. `state.marks[m]` shape `{part,section,tempo,expr}` consistent in Tasks 1, 4, 8.
```
