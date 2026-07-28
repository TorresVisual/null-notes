# Ink canvas notes — implementation plan

**Created:** 2026-07-28
**Supersedes:** the fixed-size inline block as the *primary* ink surface (`docs/plans/ink.md`, `ink-toolbar-polish.md`). Inline blocks stay — they are right for a diagram inside a typed note. They are wrong for a page of handwritten maths.

## Why

Measured against OneNote, the inline block failed on the two things that matter most for lecture notes: you write inside a fixed rectangle, at 1:1 scale, and when you reach the bottom you stop. The tool gaps (presets, lasso, point eraser, ruler) are real but secondary — a better toolbox inside a box that is still too small does not fix note-taking.

## Model

A **canvas note** is an ordinary `.md` whose body is a heading plus one `ink` fence:

    # Lecture 07 — Laplace transforms

    ```ink
    {"src":"Lecture 07.ink/page.svg","width":900,"height":1200}
    ```

*As built:* the fence is the existing `ink` block, not a new `ink-page` kind. A
canvas note is therefore not a separate document type at all — it is a normal
note that opens with a tall, growing ink block, with room to type underneath.
That removed the need for a distinct `InkPage` surface and a `Layout` branch:
the canvas rides the ordinary note flow, and every editor feature keeps working
around it.

Consequences, all deliberate:

- **The heading stays.** `title_from_content` keeps working, so the sidebar, tabs, search and `[[wiki-links]]` treat a canvas note like any other note.
- **Plain `.md` remains the source of truth** (principle #1). The file is still readable, greppable and portable; the strokes live in an SVG sidecar beside it, exactly as inline blocks already do.
- **Source view is the escape hatch.** Toggling to Source shows the fence, so nothing is trapped behind a canvas that fails to load.
- **Page height lives in the SVG** (`data-height`) — growth is then a property of the drawing, and the `.md` never churns while you write. The size in the fence is only the seed used before the sidecar loads; once it is read, the SVG wins.

## Surface behaviour

- **Vertical growth.** When a stroke lands within `GROW_MARGIN` of the bottom, the page extends by `PAGE_STEP` and persists. The page never shrinks on its own — reclaiming space is an explicit action, so growth cannot destroy strokes.
- **Zoom, not pan.** Zoom presets scale the canvas; the page is tall and scrolls with the note, so vertical panning is just scrolling and no 2D pan is needed. Strokes are always stored in unscaled page coordinates — zoom is a view property and never reaches the file.
- **Grid** is CSS behind a transparent canvas, so it scales with zoom and never enters the SVG.

## Phases

Each phase is independently shippable and leaves the app working.

### Phase 1 — the surface — **done**

- [x] `lib/canvasNote.ts`: `canvasNoteBody` (pure, tested)
- [x] `InkCanvas`: full-width canvas, vertical growth, zoom presets
- [x] `useInkCanvas`: zoom-aware pointer coordinates and backing store
- [x] ~~`Layout`: render `InkPage` instead of the TipTap editor~~ — dropped; the canvas is an ink block inside the ordinary editor, so there is no separate surface to switch to
- [x] ~~`isCanvasNote`, `canvasSrcFrom`~~ — dropped with the `Layout` branch that would have needed them
- [x] Sidebar: "New canvas note"

Also landed here: one finger scrolls the page and two pinch to zoom, and the
pen's eraser end erases without touching the toolbar.

**Done when:** a canvas note can be created, written on with the pen past the original bottom edge, zoomed, closed and reopened with every stroke intact.

### Phase 2 — pens and highlighter — **done**

- [x] `Stroke` gains `opacity` (and the SVG a `data-opacity`) — a highlighter is a wide, transparent stroke drawn beneath the ink (`paintOrder.ts`, applied to the canvas and the saved SVG alike)
- [x] Preset bar: configured pens (colour + width + opacity), one tap to switch, remembered across notes

The selected preset *is* the pen — the colour and size controls edit it in
place, which is what makes a pen you configured still be there in tomorrow's
lecture. A highlighter is not a tool, only a pen that is wide and translucent.

**Deviation:** presets persist to webview storage (`pens.ts`), not the settings
file — P2-1 has not been built. Every read and write of them goes through that
one module, so moving them into the config file is a change to four functions.

### Phase 3 — lasso — **done**

- [x] Freeform selection, point-in-polygon against stroke points (`lasso.ts`, ray casting, so concave loops behave)
- [x] Move the selection by dragging; delete the selection (toolbar button and <kbd>Del</kbd>/<kbd>Backspace</kbd>)
- [x] ~~Reuses `hitTest.ts` for shapes~~ — shapes are judged by containment of their corners instead: `hitTest` answers "is the pen touching this?", which is the eraser's question, not the lasso's

Selection is containment, not intersection — clipping the tail of a word leaves
it where it is. Dragging from inside the marquee moves what it holds, which is
what avoids needing a separate move tool. A move is one undo entry and one file
write however far the pen wanders, matching the eraser. The marquee itself is
never serialised: a selection is something you are holding, not something the
note contains.

### Phase 4 — erasers — **done**

- [x] Point eraser: split a stroke at the erased span instead of dropping it whole (`pointEraser.ts`)
- [x] Eraser size independent of pen size, remembered alongside the pens

The point eraser replaces whole-stroke deletion rather than joining it as a
second mode — the plan said "instead of", and a mistake is one undo away
anyway. Shapes are still erased whole: a rectangle cut in half is not a
rectangle, so there is nothing to split. Fragments after the first get fresh
ids, because a derived id would collide the second time the same stroke is cut.

The size slider follows whichever tool is in hand, and the eraser is measured as
a diameter in page units — what you see under the cursor is what it takes.

### Phase 5 — ruler ← *current*

- [ ] On-screen straightedge, rotatable, strokes snap to its edge

## Explicitly not building

- **Ink → text / ink → maths.** A recognition engine, with the same accuracy ceiling and dependency weight that got the OCR pipeline cut in the roadmap.
- **Freeform 2D canvas with ink over typed text.** No honest Markdown representation; it would break principle #1.
- **Tilt/shading.** Revisit only if the pen in use reports `tiltX`/`tiltY` usefully.
