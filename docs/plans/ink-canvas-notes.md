# Ink canvas notes — implementation plan

**Created:** 2026-07-28
**Supersedes:** the fixed-size inline block as the *primary* ink surface (`docs/plans/ink.md`, `ink-toolbar-polish.md`). Inline blocks stay — they are right for a diagram inside a typed note. They are wrong for a page of handwritten maths.

## Why

Measured against OneNote, the inline block failed on the two things that matter most for lecture notes: you write inside a fixed rectangle, at 1:1 scale, and when you reach the bottom you stop. The tool gaps (presets, lasso, point eraser, ruler) are real but secondary — a better toolbox inside a box that is still too small does not fix note-taking.

## Model

A **canvas note** is an ordinary `.md` whose body is a heading plus one `ink-page` fence:

    # Lecture 07 — Laplace transforms

    ```ink-page
    {"src": "Lecture 07.ink/page.svg"}
    ```

Consequences, all deliberate:

- **The heading stays.** `title_from_content` keeps working, so the sidebar, tabs, search and `[[wiki-links]]` treat a canvas note like any other note.
- **Plain `.md` remains the source of truth** (principle #1). The file is still readable, greppable and portable; the strokes live in an SVG sidecar beside it, exactly as inline blocks already do.
- **Source view is the escape hatch.** Toggling to Source shows the fence, so nothing is trapped behind a canvas that fails to load.
- **Page height lives in the SVG** (`data-height`), not in the fence — growth is then a property of the drawing, and the `.md` never churns while you write.

## Surface behaviour

- **Vertical growth.** When a stroke lands within `GROW_MARGIN` of the bottom, the page extends by `PAGE_STEP` and persists. The page never shrinks on its own — reclaiming space is an explicit action, so growth cannot destroy strokes.
- **Zoom, not pan.** Zoom presets scale the canvas; the page is tall and scrolls with the note, so vertical panning is just scrolling and no 2D pan is needed. Strokes are always stored in unscaled page coordinates — zoom is a view property and never reaches the file.
- **Grid** is CSS behind a transparent canvas, so it scales with zoom and never enters the SVG.

## Phases

Each phase is independently shippable and leaves the app working.

### Phase 1 — the surface ← *current*

- [ ] `lib/canvasNote.ts`: `isCanvasNote`, `canvasSrcFrom`, `canvasNoteBody` (pure, tested)
- [ ] `InkPage.tsx`: full-width canvas, vertical growth, zoom presets
- [ ] `useInkCanvas`: zoom-aware pointer coordinates and backing store
- [ ] `Layout`: render `InkPage` instead of the TipTap editor for canvas notes
- [ ] Sidebar: "New canvas note"

**Done when:** a canvas note can be created, written on with the pen past the original bottom edge, zoomed, closed and reopened with every stroke intact.

### Phase 2 — pens and highlighter

- [ ] `Stroke` gains `opacity` (and the SVG a `data-opacity`) — a highlighter is a wide, transparent stroke drawn beneath the ink
- [ ] Preset bar: configured pens (colour + width), one tap to switch, remembered across notes via the settings file (P2-1)

### Phase 3 — lasso

- [ ] Freeform selection, point-in-polygon against stroke points
- [ ] Move the selection by dragging; delete the selection
- [ ] Reuses `hitTest.ts` for shapes

### Phase 4 — erasers

- [ ] Point eraser: split a stroke at the erased span instead of dropping it whole
- [ ] Eraser size independent of pen size

### Phase 5 — ruler

- [ ] On-screen straightedge, rotatable, strokes snap to its edge

## Explicitly not building

- **Ink → text / ink → maths.** A recognition engine, with the same accuracy ceiling and dependency weight that got the OCR pipeline cut in the roadmap.
- **Freeform 2D canvas with ink over typed text.** No honest Markdown representation; it would break principle #1.
- **Tilt/shading.** Revisit only if the pen in use reports `tiltX`/`tiltY` usefully.
