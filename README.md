# Resonote — a handpan notation studio

Resonote is a single-file web app for **writing, hearing, and printing handpan
patterns**. It's inspired by Notepan's number-based notation and built around a
D Kurd 10+3, but it works with any scale you configure.

No build step, no dependencies to install — it's one HTML file. Open it in a
browser and go.

**Run it two ways:**

- **Hosted (recommended, works on iPad):** <https://roel-heremans.github.io/handpan/>
  — nothing to install; on iOS you can *Share → Add to Home Screen* for an
  app-like shortcut.
- **Local:** open `resonote.html` in a desktop browser (note: iOS Safari won't
  render a local `.html` file — use the hosted link on iPad).

---

## Backlog

- **Performance section**:
  - Hiding the handpan display option and freeing space for showing more tacks — **[DONE]**
    ("Hide pan" toggle in the perform bar swaps the pan for a second look-ahead notation row)
  - Having sliding option to go back and forth on the displayed notes additionally to  
    the jump back and forward option — **[DONE]**
  - Saving the entered songs in a database that you can reload and this between systems
  - Adding the Allan Walker song as the default song to be loaded when first opening the app — **[DONE]**
  - A slowest **0.25×** performance speed — **[DONE]**
  - The 2 meassures in the performance view should be slightly more compressed in a way that 
    it allows to have exactly 2 meassures fitting in the display. 
  - performance at speed 0.25x

---

## Features

- **Interactive pan diagram** — an accurate zigzag layout (note 1 at the bottom,
  odds up the right, evens up the left) with the ding in the centre and the three
  underside notes shown as dashed circles at their real positions. Tap any note to
  hear it. Toggle the underside markings on/off.
- **Step-grid editor** — write patterns per subdivision (eighths / triplets /
  sixteenths), with measures stacked vertically one below the other.
- **Left / right hands** — tap a cell to cycle empty → right → left → off. Hands
  are colour-coded and panned slightly left/right on playback.
- **Strokes** — ding (`D`), ding-shoulder (`d`), tak (`t`), slap (`s`), ghost
  (`g`), plus the numbered tone fields.
- **Synth or your own pan** — a built-in handpan synth (fundamental + octave +
  fifth with reverb), or record/upload each tone field and play patterns back
  with your real instrument.
- **Printable sheet** — export a PDF where each subdivision stacks the right hand
  (red, top two slots) above the left hand (black, bottom two), split by a grey
  divider, with placeholder dots for empty slots.
- **Save / Export / Import** — patterns persist in the browser, and can be
  exported to a JSON backup file and re-imported later.

## Running it

Just open `resonote.html` in any modern browser (Chrome, Edge, Firefox, Safari).

To serve it locally instead (useful for microphone access on some browsers):

```bash
# from the repo folder
python3 -m http.server 8000
# then visit http://localhost:8000/resonote.html
```

## GitHub Pages

`index.html` redirects to `resonote.html`, so you can publish the app for free:

1. Push this repo to GitHub (see below).
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Pick the `main` branch, `/ (root)` folder, and save.
4. Your app will be live at `https://<user>.github.io/<repo>/`.

## Notes & limitations

- **PDF export** loads a small library (jsPDF) from a CDN at runtime, so the first
  PDF needs an internet connection. If offline, the Save button falls back to a
  downloadable, self-printing HTML sheet.
- **Microphone recording** needs browser permission and a secure context
  (https or localhost). If it's blocked, use the per-note **Upload** option
  instead.
- **Persistence** uses the browser's `localStorage`. Patterns are tiny and persist
  reliably; long audio recordings can bump into browser storage limits, so keep a
  JSON backup via **Export** for anything important.

## Tech

Vanilla HTML/CSS/JS in one file. Web Audio API for synthesis, sampling, and
playback; MediaRecorder for recording; jsPDF for PDF export. No framework.

## License

MIT — see [LICENSE](LICENSE).
