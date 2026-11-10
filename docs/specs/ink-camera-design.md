# Ink camera — design

Status: draft for approval · 2026-11-10

## Intent

The full-screen ink editor should behave like an infinite whiteboard: zoom lands under the cursor or fingers, panning is free in every direction, and nothing resizes or jumps while you draw. Today it is a bounded page inside a scroll container, which cannot do any of that:

- Zoom keeps the point under the cursor by scrolling afterwards (`useZoomAnchor.ts`). A scroll container can only scroll within its content, so whenever the page is smaller than the window, or the point is near an edge, the scroll offset clamps and the page grows away from its top-left corner.
- Each zoom step is a React state change that resizes the `<canvas>`, re-rasterises and refills every stroke.
- The page grows in 400-unit steps and stops at 8000 × 8000 (`growCanvas.ts`). Growing left or up is hidden by nudging `scrollLeft/Top`, which can show as a jump.

The change replaces the scroll-and-grow model with a **camera**: a pan offset and a scale over the existing ink coordinates.

## Goals

- Wheel/pinch/keyboard zoom keeps the world point under the cursor (or pinch midpoint) fixed, anywhere, at any zoom.
- Pan is unbounded in all four directions. No size cap, no growth steps, no scroll compensation.
- The canvas is exactly the window's size and never resizes while drawing or zooming.
- Zoom range widens from 0.5–3× to 0.1–8×.
- Inline ink in notes becomes a read-only preview, tuned for that job.
- Drawing on imported PDF pages moves into the full-screen editor, with the page shown as a backdrop.

## Non-goals

- Changing how a stroke is drawn or feels (perfect-freehand options, pressure, smoothing). The pen feels fine.
- Changing the `.ink/*.svg` sidecar format. Stroke, shape and text data and the `originX/originY/width/height` attributes keep their meaning as the file's declared extent.
- Persisting camera position. It resets on each open (fits the ink).
- `.canvas` (JSON Canvas) files. They are a separate feature.
- Touch drawing. Fingers still never draw.

## Anti-goals

- Any change that moves a stored coordinate of existing ink.
- A note whose drawing shows differently in the preview than it did before (clipped, shifted, or blank).
- Dirty-buffer or save-path regressions: ink still saves through the existing ink write path, one write per gesture, one history entry per gesture.

## Constraints

- Storage boundary: nothing new is persisted, so there is no new sync decision. The sidecar stays inside the workspace.
- Existing notes contain `#ink=WxH,inline` in markdown (`InkBlock.ts`). They must still load.
- `build:web` must still work (`src/web/` shims) — no new `@tauri-apps/*` imports expected.
- Strict TypeScript, no `any`; one component per file; logic in hooks.

## Approaches considered

1. **Scrollable margin around the page.** Pad the scroll content so the anchor is always reachable. Small diff; fixes the clamping bug. Keeps resize-per-zoom, blur, growth steps and the 8000 cap.
2. **Camera (chosen).** Pan/zoom transform over unbounded coordinates; viewport-sized canvas. Fixes anchoring exactly, removes growth and its jump, makes zoom cheap. Rewrites the coordinate handling in `useInkCanvas`/`InkCanvas` and the tests around zoom/origin/growth.
3. **Scroll model plus a CSS transform during the gesture.** Smooths zoom but not the clamping; would still need option 1.

Chosen by the user: option 2, scoped to the full-screen editor only.

## Design

### Camera model

View state `{ x, y, scale }` lives in the editor session only. World→screen: `screen = (world − (x, y)) · scale`. `toInk()` becomes the inverse of that and stays the single place pointer coordinates are mapped. `originX/originY` stop being a rendering concern: they are only the file's declared extent.

- Zoom about a screen point `p`: pick the world point under `p`, set the new scale (clamped 0.1–8), solve `x, y` so that world point stays under `p`. Same function serves Ctrl+wheel, trackpad pinch, touch pinch, and keyboard (`+ − 0`, which zooms about the window centre).
- Pan: plain wheel / two-finger trackpad scroll pans; one-finger touch drag pans; middle-mouse drag and Space+drag pan. Pen and mouse-left keep drawing.
- On open, the camera fits the ink bounds (or centres the origin if empty) at a scale capped at 1.

### Rendering

- One `<canvas>` sized to the editor body × `devicePixelRatio`, resized only on window resize.
- Each frame: clear, apply the camera transform, paint strokes, shapes, texts, selection, ruler (all in world units). Skip items whose bounds miss the viewport.
- The grid is drawn on the canvas from the camera (fading out below a minimum on-screen spacing), replacing the CSS background.
- The eraser cursor and the text-editing `<textarea>` are positioned from the camera instead of `(x − originX) · zoom`.
- The existing layer cache is a candidate for caching committed strokes between camera changes; the builder decides whether the measured cost justifies it.

### Saving and extent

On save, the declared extent is the ink bounds plus the existing 40-unit crop padding (`cropToContent` logic), minimum a small default for an empty drawing. `growCanvas`, `GROW_MARGIN`, `PAGE_STEP`, `MAX_EXTENT`, `scrollShift` and the `autoGrow`/`growAllSides` props are removed. Undo/redo restore ink only; the extent is recomputed from the result.

### Inline ink in notes: preview only

- `InkBlockView` always renders `InkPreview`. The live `InkCanvas` branch and the per-block zoom state are deleted.
- The `inline` attribute is still parsed from both the image-URL fragment and the legacy fence and still round-trips untouched; the view just ignores it. No churn in synced notes, and older app versions read the note unchanged.
- Preview tuning is left to the builder within these bounds: it already renders the sidecar as sanitised SVG at a capped height (`previewScale`); it must keep doing that without mounting a canvas, and clicking still opens the full-screen editor.

### PDF pages

- `PdfPageBlock` renders the page image with the drawing as an SVG preview overlay (read-only, transparent) and opens the full-screen editor on click.
- `InkEditorOverlay` gains an optional backdrop (the page image and its pixel size). The camera draws it under the ink; ink stays in the page's native pixel space exactly as stored today.
- In backdrop mode the declared extent stays the page rectangle rather than being recomputed from the ink, so the overlay keeps lining up with the image. Ink outside the page is kept in the file but clipped in the preview. *(My call.)*

### Tests

Rewritten or removed: `growCanvas.test.ts`, `inkInfinitePage.test.tsx`, `zoom.test.ts` (anchor/pinch math), parts of `useInkCanvas.test.ts`, `inkEditorOverlay.test.tsx`, `inkCanvasSaved.test.tsx`, `inkBlockMount.test.tsx`, `inkBlockFence.test.ts`, `inkCanvasActivation.test.tsx`. New: pure camera math (zoom-about-point keeps the point fixed; pan; fit), and one overlay test that wheel-zooms at a position and asserts the world point under it is unchanged.

## Settled in review (2026-11-10)

- Plain wheel / two-finger scroll pans; Ctrl+wheel and pinch zoom.
- Ships as three independent commits, each leaving the app working: (1) camera in the full-screen editor, (2) inline ink becomes preview-only, (3) PDF page drawing moves to the full-screen editor with a backdrop.
- Preview is a tight crop around the ink (bounds + 40 padding) with a minimum size so a single dot doesn't become a speck.
- Camera is not remembered between opens.
- Design for about 5,000 strokes in one drawing; measure, add caching only if it stutters.
- Keyboard zoom steps are not animated (dropped from the camera section as unneeded).
- PDF backdrop: page rectangle is the fixed extent; ink outside it is kept and clipped in the preview.

## Left to the builder

- Frame-cost measures and whether to use the layer cache or culling beyond viewport rejection.
- Grid fade thresholds and the minimum extent.
- Whether the camera math lives in `src/ink/camera.ts` (pure) with a `useCamera` hook — expected, since the project keeps pure logic in plain modules.
- Updating any docs or skills that mention inline ink or the 8000-unit cap (`docs/`, `skills/`, `ROADMAP.md`).

## Open risk

Large drawings repainted every pan frame with no cache could stutter. The viewport rejection test is the first defence; measure with a few thousand strokes before adding more.
