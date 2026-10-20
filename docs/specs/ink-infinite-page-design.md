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

`InkData` gains `originX` and `originY` (default 0): the page's top-left in ink coordinates. The SVG header becomes `viewBox="originX originY width height"` plus `data-origin-x` / `data-origin-y`. The reader defaults both to 0, so every existing file opens unchanged. An older build opening a file that has grown leftward keeps all stroke data (points are stored per stroke); it would only place that ink outside its own canvas.

Because the origin moves instead of the strokes, this avoids the translate-everything-and-compensate-scroll risk that `growCanvas.ts` cited for not growing left/up.

### Growth

`growCanvas` works on full bounds (`minX / minY / maxX / maxY`) and returns the new origin and size. It grows by `PAGE_STEP` on any side whose content is within `GROW_MARGIN` of that edge. `useInkCanvas` gains a `growAllSides` option; the overlay passes it. Existing `autoGrow` call sites are unchanged.

### Coordinate mapping

About ten sites in `useInkCanvas` compute `e.offsetX / zoom` directly. They go through one `toInk(e)` helper that adds the origin, and the draw transform subtracts it. The same applies to `InkCanvas`'s `pagePoint`, the eraser cursor, the text editor position, and the grid `background-position` (so the grid stays aligned to ink coordinates).

### No visual jump

Growing left or up adds screen space before the existing ink. After such a growth the overlay's scroll container is advanced by `growth × zoom` in a layout effect, so nothing already drawn moves on screen. The offset math is a pure function with unit tests; the rest is manual QA.

### Size cap

Extent is capped at 8000 units per axis. The backing-store scale is clamped so `extent × scale ≤ 16384` px (the browser canvas limit). At extreme sizes sharpness degrades gracefully instead of the canvas failing to render.

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

- `growCanvas`: each of the four sides, margin boundaries, and the cap.
- `svgSerialiser`: round-trip with a negative origin; legacy file defaults to 0.
- Scroll-compensation offset math (pure).
- Manual QA in `npm run tauri dev`: draw past each edge, confirm no jump, then save/reload and confirm positions and the preview.
- `npm run typecheck`, `npm test`.
