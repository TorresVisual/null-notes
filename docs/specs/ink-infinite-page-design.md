# null-notes — Ink Infinite Page Design

**Date:** 2026-10-20
**Scope:** Sub-project 3 of 4 in the "make free drawing feel like OneNote" effort. Depends on `ink-fullscreen-editor-design.md` (the overlay supplies the scroll container and opts in to all-sides growth).

---

## Goal

In the full-screen editor the page grows in every direction as ink approaches an edge, instead of only right and down.

## Non-Goals

- No truly unbounded viewport / camera / culling renderer (a much larger project, deliberately not chosen).
- Inline canvases (canvas notes, PDF pages) keep today's right/down-only growth.
- No change to stroke point storage — coordinates of existing ink never change.

---

## Design

### Format

`InkData` gains `originX` and `originY` (default 0): the page's top-left in ink coordinates. The SVG header becomes `viewBox="originX originY width height"` plus `data-origin-x` / `data-origin-y`. The reader defaults both to 0, so every existing file opens unchanged. An older build opening a file that has grown leftward keeps all stroke data (points are stored per stroke); it would only place that ink outside its own canvas, and on save rewrites the header as `0 0 w h`. So the reader also widens the origin on load to cover the content bounds (`originX = min(originX, minX − GROW_MARGIN)`, likewise Y), which recovers such files and hand-edited or merged ones.

Because the origin moves instead of the strokes, this avoids the translate-everything-and-compensate-scroll risk that `growCanvas.ts` cited for not growing left/up.

### Growth

`growCanvas` works on full bounds (`minX / minY / maxX / maxY`) and returns the new origin and size. On any side whose content is within `GROW_MARGIN` of that edge it grows by `ceil(needed / PAGE_STEP) × PAGE_STEP` — one step in the common case, more when a lasso drag or paste overshoots by several. `useInkCanvas` gains a `growAllSides` option; only the overlay for free `InkBlock`s passes it. PDF pages and canvas notes never get a non-zero origin (PDF ink sits over a fixed background image), and their existing `autoGrow` call sites are unchanged.

The page never shrinks on its own: erasing or moving ink away from a grown edge leaves the margin, and there is no auto-trim on close. Only undo shrinks it, by restoring the previous `inkData`.

### Coordinate mapping

About ten sites in `useInkCanvas` compute `e.offsetX / zoom` directly. They go through one `toInk(e)` helper that adds the origin, and the draw transform subtracts it. The same applies to `InkCanvas`'s `pagePoint`, the eraser cursor, the text editor position, the grid `background-position` (so the grid stays aligned to ink coordinates), and `centredRuler`, which centres at `originX + width/2` rather than `width/2`.

### No visual jump

Growing left or up adds screen space before the existing ink. The page is top-left anchored in the overlay's scroll container (see `ink-fullscreen-editor-design.md`), so a layout effect that compares the previous and next origin advances the scroll position by `Δorigin × zoom` — keyed on any origin change, so undo/redo (which restore the old origin and size) compensate the same way as growth. Nothing already drawn moves on screen. The offset math is a pure function with unit tests; the rest is manual QA.

### Size cap

Extent is capped at 8000 units per axis; at the cap a side simply stops growing, with no extra UI. The backing-store scale is clamped to `min(dpr · zoom, 16384 / extent, sqrt(64M / (width · height)))` — the browser's per-axis canvas limit plus a ~64M px memory budget (8000² at dpr 2 would otherwise be ~1 GB of RGBA). At extreme sizes sharpness degrades gracefully instead of the canvas failing to render.

### Preview

`InkBlock`'s static preview needs no change — the SVG's own `viewBox` renders a grown page correctly.

## File Structure

| File | Change |
|---|---|
| `src/ink/types.ts` | `originX`, `originY` on `InkData` |
| `src/ink/svgSerialiser.ts` | Write/read origin and `viewBox` |
| `src/ink/growCanvas.ts` | Bounds-based, four-sided growth, size cap |
| `src/ink/useInkCanvas.ts` | `growAllSides`, `toInk(e)`, origin-aware transform |
| `src/ink/InkCanvas.tsx` | Origin-aware `pagePoint`, cursor, text editor, grid |
| `src/ink/InkEditorOverlay.tsx` | Pass `growAllSides`; scroll compensation |

## Testing

- `growCanvas`: each of the four sides, margin boundaries, multi-step overshoot, and the cap.
- `svgSerialiser`: round-trip with a negative origin; legacy file defaults to 0; origin widened on load when content lies outside it.
- `useInkCanvas`: `toInk` honours a non-zero origin.
- Backing-store scale clamp (per-axis and area budget).
- Scroll-compensation offset math (pure), including an undo-driven origin change.
- Manual QA in `npm run tauri dev`: draw past each edge, confirm no jump, then save/reload and confirm positions and the preview.
- `npm run typecheck`, `npm test`.
