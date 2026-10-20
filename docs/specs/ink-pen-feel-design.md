# null-notes — Ink Pen Feel Design

**Date:** 2026-10-20
**Scope:** Sub-project 4 of 4 in the "make free drawing feel like OneNote" effort (see `ink-fullscreen-editor-design.md` for the others). Independent of the other three; can ship in any order.

---

## Goal

Strokes follow the pen with no perceptible lag regardless of how much is already on the page, and the canvas can be drawn on with a mouse.

## Findings (current code, `src/ink/useInkCanvas.ts`, `src/ink/svgSerialiser.ts`)

- `redrawCanvas` clears the canvas and re-runs `getStroke` for **every** stroke on **every** pointer-move, so latency grows with page content.
- No latency compensation (no predicted points).
- One repaint per pointer event, not per frame. Shape and lasso previews repaint per event too.
- Only `pointerType === 'pen'` draws (guards in `handlePointerDown`, `handlePointerMove`, `handlePointerUp`); mouse and touch cannot. `InkCanvas` also gates the eraser cursor ring on `pen`.
- One global `{ smoothing: 0.5, streamline: 0.5 }` for every pen kind, duplicated in `svgSerialiser.ts`.
- **Real pen pressure is ignored.** Both call sites use perfect-freehand's default `simulatePressure: true`, so width comes from stroke velocity and the captured `pressure` is discarded.
- Straightening is not a hold gesture: `straightLineEnds` runs on `pointerup` and converts any stroke within 4% chord deviation into a `line` shape.
- Already good, kept as-is: coalesced events, ruler snapping.

## Non-Goals

- No WebGL / new renderer, no pressure-curve editor, no change to the SVG sidecar format or `Stroke` type.
- Touch still never draws (it pans and pinch-zooms; palm rejection is unchanged).
- Erase, lasso-move and text-drag stay O(strokes) per move (they mutate `inkData` every move, so they invalidate the cache). File as a follow-up.

---

## Design

1. **Committed-layer cache.** Strokes, shapes and text items are drawn once into an offscreen canvas (a plain `<canvas>` element, so jsdom and WebView2 both work). It is re-rendered only when `inkData`, zoom, device pixel ratio or the text being edited changes. Each pointer-move blits that layer and draws only the live stroke (plus live shape / lasso / ruler overlays). Per-move cost no longer scales with page content during drawing. The pure part — "does the cache key still match?" — lives in a small module so it can be tested. Committing a stroke invalidates the cache and costs one full rebuild at stroke end; incremental append is not possible because `paintOrder` may place a new highlighter stroke under existing ink. Measure in QA; optimise only if it visibly hitches.

2. **Prediction.** While drawing, `getPredictedEvents()` points are merged onto a copy of the live buffer for that frame's paint only, then passed through `snappedPoints` so the tail stays on the ruler. They are never pushed to `currentStroke` and never stored. Freehand strokes only (not shapes or lasso); skipped when `getPredictedEvents` is missing.

3. **Frame batching.** All live previews (freehand, shape, lasso) go through one `scheduleRedraw` that schedules at most one `requestAnimationFrame` repaint, replacing the direct `redrawCanvas` calls in `handlePointerMove`. `pointerup` and `pointercancel` cancel any pending frame and paint synchronously.

4. **Mouse drawing.** The three `pointerType` guards accept `'mouse'` (primary button only) as well as `'pen'`, for every tool (eraser, lasso, shapes, text, ruler grab). The `InkCanvas` eraser-ring condition becomes `pen || mouse`. Mouse is always on in inline ink blocks and PDF-page overlays — a one-point click is already discarded, so stray clicks leave nothing. Mouse pressure is a constant 0.5. Mouse strokes get the same auto-straighten on release as pen strokes. `InkCanvas`'s touch handling (pan / pinch / ruler finger) is untouched. Mouse wheel scrolls the page as it does today.

5. **Real pressure and per-kind options, one place.** A new `strokeOptions(stroke)` builds every `getStroke` option object and is used by both `fillStroke` and `svgSerialiser.ts`.
   - `simulatePressure: false`, so pen pressure drives width. A mouse's constant 0.5 renders as a uniform-width line, so no pointer-type field is needed on `Stroke`.
   - `streamline` / `smoothing` come from a small lookup by kind. Kind is **derived from stored fields**, not stored: `opacity < 1` is a highlighter, `thinning <= 0.2` is pencil, anything else is ink. Pencil gets lower smoothing (crisper), highlighter higher.
   - Existing strokes re-render with the new options on load (points are stored raw); that is accepted.
   - Values are tuned by eye in the running app and are not unit-tested. If the width shift on existing notes is visible in QA (pressure 0.5 renders at 0.5 × `size`), add one global width factor inside `strokeOptions()` rather than editing pen presets.

## File Structure

| File | Change |
|---|---|
| `src/ink/useInkCanvas.ts` | Offscreen layer, `scheduleRedraw`, predicted points, mouse guards, use `strokeOptions` |
| `src/ink/InkCanvas.tsx` | Eraser ring shown for mouse as well as pen |
| `src/ink/svgSerialiser.ts` | Use `strokeOptions` instead of hardcoded 0.5 / 0.5 |
| `src/ink/layerCache.ts` | New — pure cache-key comparison |
| `src/ink/strokeOptions.ts` | New — `strokeOptions(stroke)`: kind derivation, smoothing table, `simulatePressure: false` |
| `src/ink/predict.ts` | New — pure merge of predicted points onto the live buffer |

## Testing

- Unit tests for `layerCache`, `predict` and `strokeOptions` (kind derivation and `simulatePressure: false`; smoothing values excluded).
- One hook test: a `mouse` pointer sequence commits a stroke; a `touch` sequence does not.
- Manual QA in `npm run tauri dev` on a note with ~500 strokes: before/after profile of pointer-move → paint time (use the browser performance profiler), including the one-time rebuild at stroke end; eyeball smoothing on each pen kind; compare stroke width on an existing note before/after; confirm touch still pans and mouse can draw, erase and straighten.
- `npm run typecheck`, `npm test`.
