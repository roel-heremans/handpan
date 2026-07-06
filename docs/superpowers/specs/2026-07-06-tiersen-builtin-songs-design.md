# Built-in Songs Library + "Die Arpeggios von Yann Tiersen" — Design

Date: 2026-07-06
Status: Implemented

## Goal

Add **"Die Arpeggios von Yann Tiersen" (Paul Erdmann arrangement)** to the app,
and introduce a small **built-in songs library** so shipped songs (Faded, and
now Tiersen) are browsable and loadable — not only the localStorage patterns the
user saves themselves.

Backlog origin: user request "add to the library 'Die Arpeggios von Yann
Tiersen' (see pdf folder)".

## Decisions

- **Surfacing:** built-in songs appear as a **"Built-in songs"** group at the top
  of the existing Saved-patterns panel, each with a **Load** button. The user's
  own saves follow under a **"Your patterns"** group. Faded still loads on open.
  (Chosen over a separate dropdown or seeding into localStorage.)
- **Source of truth:** like Faded, the song is transcribed from its PDF by an
  **offline dev parser** (`scripts/parse-tiersen.mjs`) → `scripts/tiersen.json`,
  embedded in `resonote.html` as `const TIERSEN`. A `const SONGS = [FADED,
  TIERSEN]` registry drives the library list.

## The pattern (from the PDF)

- **Instrument** `D Kurd 8+1`: ding `D3`, 8 top fields (1 A3, 2 Bb3, 3 C4, 4 D4,
  5 E4, 6 F4, 7 G4, 8 A4). No underside notes.
- **Grid** `beats=4`, `sub=4` (16 cells/measure), `measures=29`. Standard 4/4 —
  the "1/3 2/3 3/3" glyphs in the PDF are page numbers (footer), not triplets.
- **Sections** `A-1`(m1), `A-2`(m5), `A-3`(m9), `A-4`(m13), `A-5`(m17),
  `A-6`(m21), `Outro`(m25). **Tempo** `♩=53` opening, `♩=48` + `rall.` near the
  end.
- **Strokes:** tone fields 1-8, ding `D`, ding-shoulder `d`. A bare `*` marks the
  Outro measures with a footnote reference (not a played note) — ignored.

## Parser notes (differences from parse-faded.mjs)

- **Section labels** are a taller font (~15px) than notes (~14px): forms `A`+`-`
  +`N` (three adjacent words → `A-N`) and standalone `Outro`. They are collected
  first, excluded from note assignment, and turned into section marks.
- **Per-measure cell width:** Tiersen's measure widths vary (~261 full rows,
  ~348-368 sparse Outro rows), so each measure uses its own width/16 rather than
  a single global width; the last measure of a row inherits the median.
- **Both-hands unison:** the grid model `grid[step][voice] = one hand` cannot
  represent the same voice struck by both hands at one step. Exactly one such
  clash exists (M28 s0, field 1); the right hand (melodic, `*`-annotated) is
  kept and the clash is logged.

## Verification

Render-and-diff against the source PDF pages 2-4 (the app's printable sheet vs.
`pdftoppm` page images): measures 1-29 match note-for-note, including the Outro
stacked chords, the `d` stroke, sections, tempo, and `rall.`. Parser self-checks:
0 unknown tokens, 1 logged both-hands-unison collision, 3 ignored `*`
annotations.

## Out of scope

- A general in-app PDF importer (parser stays an offline dev script).
- Editing/removing built-in songs (they are read-only; loading one is a normal
  pattern load that the user can then edit or save).
