# null-notes — Ink Pen Feel Design

**Date:** 2026-10-20
**Scope:** Sub-project 4 of 4 in the "make free drawing feel like OneNote" effort (see `ink-fullscreen-editor-design.md` for the others). Independent of the other three; can ship in any order.

---

## Goal

Strokes follow the pen with no perceptible lag regardless of how much is already on the page, and the canvas can be drawn on with a mouse.

## Findings (current code, `src/ink/useInkCanvas.ts`)

- `redrawCanvas` clears the canvas and re-runs `getStroke` for **every** stroke on **every** pointer-move, so latency grows with page content.
- No latency compensation (no predicted points).
- One repaint per pointer event, not per frame.
- Only `pointerType === 'pen'` draws (guards in `handlePointerDown`, `handlePointerMove`, `handlePointerUp`); mouse and touch cannot.
- One global `{ smoothing: 0.5, streamline: 0.5 }` for every pen kind.
- Already good, kept as-is: coalesced events, pressure, hold-to-straighten, ruler snapping.

## Non-Goals

- No WebGL / new renderer, no pressure-curve editor, no change to the SVG sidecar format or `Stroke` type.
- Touch still never draws (it pans and pinch-zooms; palm rejection is unchanged).

---

## Design

1. **Committed-layer cache.** Strokes, shapes and text items are drawn once into an offscreen canvas. It is re-rendered only when `inkData`, zoom, device pixel ratio or the text being edited changes. Each pointer-move blits that layer and draws only the live stroke (plus live shape / lasso / ruler overlays). Per-move cost no longer scales with page content. The pure part — "does the cache key still match?" — lives in a small module so it can be tested.

2. **Prediction.** While drawing, `getPredictedEvents()` points are appended to a copy of the live buffer for that frame's paint only. They are never pushed to `currentStroke` and never stored.

3. **Frame batching.** Pointer-moves push coalesced points into the buffer and schedule at most one `requestAnimationFrame` repaint, instead of repainting per event. `pointerup` flushes synchronously.

4. **Mouse drawing.** The three `pointerType` guards accept `'mouse'` (primary button only) as well as `'pen'`. Mouse pressure is a constant 0.5, which perfect-freehand handles through `thinning`. Mouse gets the eraser cursor ring and hold-to-straighten. `InkCanvas`'s touch handling (pan / pinch / ruler finger) is untouched. Mouse wheel scrolls the page as it does today.

5. **Per-kind smoothing.** `streamline` / `smoothing` move from one constant to a small lookup keyed by pen kind (pencil lower for a crisper line, highlighter higher). Exact values are tuned by eye in the running app and are not unit-tested.

## File Structure

| File | Change |
|---|---|
| `src/ink/useInkCanvas.ts` | Offscreen layer, rAF batching, predicted points, mouse guards |
| `src/ink/layerCache.ts` | New — pure cache-key comparison |
| `src/ink/strokeOptions.ts` | New — per-pen-kind smoothing table |
| `src/ink/predict.ts` | New — pure merge of predicted points onto the live buffer |

## Testing

- Unit tests for `layerCache`, `predict` and `strokeOptions` (pure).
- One hook test: a `mouse` pointer sequence commits a stroke; a `touch` sequence does not.
- Manual QA in `npm run tauri dev` on a note with ~500 strokes: before/after profile of pointer-move → paint time (use the browser performance profiler); eyeball smoothing on each pen kind; confirm touch still pans and mouse can draw, erase and straighten.
- `npm run typecheck`, `npm test`.
