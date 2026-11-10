# Ink Camera Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** The full-screen ink editor becomes an unbounded pan/zoom canvas whose zoom lands under the cursor; inline ink in notes and on PDF pages becomes preview-only.

**Architecture:** Three parts, each ending with a working app. Part A makes inline ink blocks preview-only. Part B moves PDF-page drawing into the full-screen editor with a backdrop. Part C then replaces `InkCanvas`'s scroll-and-grow page with a camera (`{ x, y, scale }` over unchanged ink coordinates) — done last so `InkCanvas` has exactly one consumer (`InkEditorOverlay`) and needs no dual legacy/camera path. The `.ink/*.svg` format is untouched.

**Tech Stack:** React 19 + TypeScript (strict), Canvas 2D, perfect-freehand, Vitest + Testing Library (jsdom).

**Spec:** `docs/specs/ink-camera-design.md`. Note: the spec lists the parts as camera → preview → PDF; this plan runs them preview → PDF → camera to avoid carrying two canvas modes through the camera work.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- No stored coordinate of existing ink ever changes; only view state is new.
- Sidecar format unchanged. `#ink=WxH,inline` in markdown still parses and round-trips untouched; the view ignores it.
- Zoom range 0.1–8×. Plain wheel / two-finger scroll pans; Ctrl+wheel and pinch zoom; middle-drag and Space+drag pan; one-finger touch pans; fingers never draw.
- Camera is not persisted; it fits the ink on open (scale capped at 1). Keyboard zoom (`+ − 0`) is not animated and zooms about the window centre.
- Saved extent = ink bounds + 40 units (`CROP_PADDING`), with a minimum size so a lone dot isn't a speck. In PDF backdrop mode the extent stays the page rectangle.
- Design for ~5,000 strokes; viewport-reject off-screen items; add layer caching only if measured stutter.
- Strict TS, no `any`, no `!`; named exports; one component per file; stateful logic >5 lines in `src/hooks/`; no comments unless the WHY is non-obvious.
- Each task commits only its own files. Never touch the unrelated uncommitted edits in `src/index.css` / `src/ink/DrawRibbon.tsx` — stage by explicit path (`git add -p` for `index.css` hunks).
- Before the final commit of each part: `npm run typecheck && npm run lint && npm test`.

## Review Focus

- Mouse-wheel `deltaMode` lines/pages (not pixels) must pan a sensible distance, not 1px per notch (Task 6).
- Zoom about a point stays exact with far-from-origin coordinates (±100000) and at both scale limits (Task 4).
- A drawing with a non-zero stored origin loads, shows ink in the same place, and re-saves with every stroke byte-identical (Task 8).
- An empty drawing opens, fits, saves and previews as "Empty drawing" without NaN/Infinity extents (Tasks 4, 8).
- Window resize mid-session keeps content and camera centre, and doesn't drop an in-progress stroke (Task 7).
- Ink drawn outside a PDF page is saved but not shown outside the page in the preview (Task 3).

---

# Part A — Inline ink is preview-only

### Task 1: `InkBlockView` always renders the preview

**Files:**
- Modify: `src/editor/extensions/InkBlockView.tsx`
- Test: `src/editor/extensions/inkBlockMount.test.tsx`, `src/editor/inkCanvasActivation.test.tsx` (retarget or delete tests whose only purpose was a live inline canvas)

**Interfaces:**
- Consumes: `InkPreview({ src, width, height, editable })` (unchanged).
- Produces: nothing new. `InkBlock.ts` is not modified — the `inline` attr keeps parsing/serialising.

- [ ] **Step 1: Write the failing test** in `inkBlockMount.test.tsx`: mounting the `INLINE_FENCE` note renders `.ink-preview` and no `canvas.ink-canvas`; and `getMarkdown()` still contains `#ink=700x400,inline`.
- [ ] **Step 2: Run** `npx vitest run src/editor/extensions/inkBlockMount.test.tsx` — expect FAIL (a canvas is rendered).
- [ ] **Step 3: Implement** — delete the `inline` branch, the `InkCanvas` import and the per-block `zoom` state from `InkBlockView`; keep `inline` out of the destructure.
- [ ] **Step 4: Fix remaining tests** referencing a live inline canvas (`npx vitest run src/editor`) until green.
- [ ] **Step 5: Verify** `npm run typecheck && npm run lint && npm test` pass.
- [ ] **Step 6: Commit** `feat(ink): inline ink blocks are preview-only`.

---

# Part B — PDF pages draw in the full-screen editor

### Task 2: `InkEditorOverlay` accepts a backdrop

**Files:**
- Modify: `src/ink/InkEditorOverlay.tsx`, `src/ink/InkCanvas.tsx`, `src/index.css` (add a `.ink-canvas-backdrop` rule: transparent canvas, no grid)
- Test: `src/ink/inkEditorOverlay.test.tsx`

**Interfaces:**
- Produces: `export interface InkBackdrop { dataUrl: string; width: number; height: number }`; `InkEditorOverlay` gains optional `backdrop?: InkBackdrop`; `InkCanvas` gains optional `backdrop?: InkBackdrop`.

- [ ] **Step 1: Write the failing test:** overlay with `backdrop` renders an `img[alt="Page backdrop"]` at `width*zoom` × `height*zoom`; without it renders none.
- [ ] **Step 2: Run** `npx vitest run src/ink/inkEditorOverlay.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement:** in backdrop mode `InkCanvas` renders the `<img>` absolutely at the page origin beneath the canvas and the canvas gets `.ink-canvas-backdrop`; the overlay passes `autoGrow={!backdrop} growAllSides={!backdrop}` so the extent stays the page rectangle.
- [ ] **Step 4: Run** the file — expect PASS.
- [ ] **Step 5: Commit** `feat(ink): full-screen editor can show a page backdrop`.

### Task 3: `PdfPageBlock` becomes preview + open-in-editor

**Files:**
- Create: `src/hooks/useInkSidecar.ts`, `src/ink/InkSvg.tsx`
- Modify: `src/editor/extensions/InkPreview.tsx` (use both), `src/editor/extensions/PdfPageBlock.tsx`, `src/index.css` (remove now-dead `.pdf-page-ink .ink-canvas*` rules; add overlay rule with `overflow: hidden`)
- Test: `src/editor/extensions/pdfPageBlockInk.test.tsx` (new); existing `InkPreview` tests keep passing

**Interfaces:**
- Produces: `useInkSidecar(src: string | null): { data: InkData | null; refresh: () => void }` — the read-with-latest-wins logic now inside `InkPreview`. `InkSvg({ data }: { data: InkData })` — sanitised `inkDataToSvg` output in a block that fills its parent.
- Consumes: `InkEditorOverlay` + `InkBackdrop` from Task 2; `inkSrcFor` (unchanged).

- [ ] **Step 1: Write failing tests** (mock `api.pdf.readPage` and `inkApi`): (a) a page with strokes renders an `InkSvg` overlay inside a container whose computed `overflow` is `hidden`; (b) a stroke whose points lie outside `0..width/0..height` stays in the data passed to `inkApi.write` untouched (nothing is clamped); (c) clicking an editable page opens the overlay with `backdrop` set to that page's `dataUrl`, width and height; (d) a non-editable editor does not open it.
- [ ] **Step 2: Run** `npx vitest run src/editor/extensions/pdfPageBlockInk.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement:** extract `useInkSidecar` and `InkSvg`; `InkPreview` uses them (behaviour unchanged); `PdfPageBlock` drops its `InkCanvas`/geometry `ResizeObserver` and renders image + `InkSvg` overlay (absolutely fills the image) and the overlay on click, closing with `refresh()`.
- [ ] **Step 4: Run** `npx vitest run src/editor src/ink` — expect PASS.
- [ ] **Step 5: Verify** `npm run typecheck && npm run lint && npm test` and open a PDF-imported note in `npm run dev:web` to confirm annotate → close → overlay appears on the image.
- [ ] **Step 6: Commit** `feat(pdf): annotate imported pages in the full-screen editor`.

---

# Part C — The camera

`InkCanvas` now has one consumer. These tasks rewrite it in place.

### Task 4: Pure camera math

**Files:**
- Create: `src/ink/camera.ts`, `src/ink/camera.test.ts`
- Modify: `src/ink/zoom.ts`, `src/ink/zoom.test.ts`

**Interfaces:**
- Produces in `camera.ts`:
  - `interface Camera { x: number; y: number; scale: number }` — `screen = (world − (x, y)) · scale`
  - `interface Viewport { width: number; height: number }`
  - `MIN_SCALE = 0.1`, `MAX_SCALE = 8`, `clampScale(scale: number): number`
  - `screenToWorld(camera: Camera, sx: number, sy: number): { x: number; y: number }`, `worldToScreen(camera: Camera, x: number, y: number): { x: number; y: number }`
  - `zoomAbout(camera: Camera, sx: number, sy: number, nextScale: number): Camera` — clamps; world point under `(sx, sy)` unchanged
  - `panBy(camera: Camera, dxScreen: number, dyScreen: number): Camera` — content follows the finger
  - `fitCamera(bounds: Bounds, viewport: Viewport, maxScale: number): Camera` — centres; `EMPTY_BOUNDS` centres world origin at scale 1
  - `isVisible(camera: Camera, viewport: Viewport, bounds: Bounds): boolean`
- `zoom.ts` keeps `pinchZoom`, `wheelZoom`, `zoomForKey`, `distanceBetween` but their clamp uses `MIN_SCALE/MAX_SCALE` (re-export `clampZoom` as `clampScale` users); removes `anchorShift`, `backingScale`, `MAX_CANVAS_*`.

- [ ] **Step 1: Write failing tests:** `zoomAbout` keeps `screenToWorld` of the anchor equal before/after for 20 sampled cameras including `x,y = ±100000` and scales at `MIN_SCALE`/`MAX_SCALE` (`toBeCloseTo(…, 6)`); `zoomAbout` past a limit clamps; `screenToWorld(worldToScreen(p)) ≈ p`; `panBy(c, 10, 0).x === c.x − 10/c.scale`; `fitCamera(EMPTY_BOUNDS, …)` has finite fields; `fitCamera` of a 2000×1000 box in 1000×500 gives scale 0.5 centred; same box with `maxScale: 1` and a 100×100 ink gives scale 1; `isVisible` true for overlapping, false for disjoint bounds.
- [ ] **Step 2: Run** `npx vitest run src/ink/camera.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the signatures above; update `zoom.ts`/`zoom.test.ts` for the new range (0.1/8) and delete the removed exports and their tests.
- [ ] **Step 4: Run** `npx vitest run src/ink/camera.test.ts src/ink/zoom.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(ink): pure camera math`.

### Task 5: Rename `growCanvas.ts` to `bounds.ts` and add `extentOf`

**Files:**
- Rename: `src/ink/growCanvas.ts` → `src/ink/bounds.ts` (and `.test.ts`); update imports (`svgSerialiser.ts`, `useInkCanvas.ts`, `InkCanvas.tsx`, tests)
- Modify: `src/ink/bounds.ts`

**Interfaces:**
- Keeps: `Bounds`, `EMPTY_BOUNDS`, `mergeBounds`, `boundsOfPoints`, `inkBounds`, `CROP_PADDING`.
- Produces: `MIN_EXTENT = 200`; `extentOf(data: InkData): InkData` — returns `data` with `originX/originY/width/height` set to ink bounds ± `CROP_PADDING`, each side at least `MIN_EXTENT`; empty ink returns origin 0,0, `MIN_EXTENT`² . Pure; strokes/shapes/texts references unchanged.
- Keeps for now: `growCanvas`, `scrollShift`, `GROW_MARGIN`, `PAGE_STEP`, `MAX_EXTENT`, `Page`, `cropToContent` — their callers are removed in Tasks 7–8, which delete them.

- [ ] **Step 1: Write failing tests** in `bounds.test.ts`: `extentOf` of one stroke at (500,500)-(510,510) → origin `(470,470)`-ish with width/height ≥ `MIN_EXTENT` containing the stroke plus padding; empty → finite `{0,0,200,200}`; `extentOf(extentOf(d))` equals `extentOf(d)` (idempotent); returned `strokes` array is `===` input's.
- [ ] **Step 2: Run** `npx vitest run src/ink/bounds.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `extentOf` and the file rename with import updates.
- [ ] **Step 4: Run** `npx vitest run src/ink` — expect PASS.
- [ ] **Step 5: Commit** `refactor(ink): rename growCanvas to bounds, add extentOf`.

### Task 6: `useCamera` — pan/zoom input

**Files:**
- Create: `src/hooks/useCamera.ts`, `src/hooks/useCamera.test.tsx`

**Interfaces:**
- Consumes: `camera.ts`, `zoom.ts`.
- Produces: `useCamera(containerRef: RefObject<HTMLElement | null>, fitTo: Bounds): { camera: Camera; viewport: Viewport; zoomToward: (scale: number) => void; toWorld: (clientX: number, clientY: number) => { x: number; y: number } }`. Attaches to `containerRef`: non-passive `wheel` (Ctrl → `zoomAbout` with `wheelZoom`; otherwise `panBy`, normalising `deltaMode` LINE ×16 and PAGE ×viewport height), middle-button and Space+left drag pan, a `ResizeObserver` keeping `viewport` and the centre fixed, and exposure of `camera` for pinch/one-finger-touch handling by `InkCanvas`. `zoomToward(scale)` zooms about the viewport centre (keyboard). The initial camera is `fitCamera(fitTo, viewport, 1)`, applied once when the first non-zero viewport and the loaded data are both available.

- [ ] **Step 1: Write failing tests** (mount a div with mocked `getBoundingClientRect` 800×600): Ctrl+wheel at (600,100) changes `camera.scale` and `toWorld(600,100)` is unchanged; plain wheel `deltaY=100` pixel mode pans by 100 screen px; wheel `deltaMode=1, deltaY=3` pans 48px; middle-button drag by (30,0) pans; Space-held left drag pans and releasing Space stops; a resize from 800×600 to 1000×600 keeps the world point at the viewport centre fixed.
- [ ] **Step 2: Run** `npx vitest run src/hooks/useCamera.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement** `useCamera` as described; camera state in a ref mirrored into React state at most once per animation frame.
- [ ] **Step 4: Run** the file — expect PASS.
- [ ] **Step 5: Commit** `feat(ink): useCamera pan and zoom input`.

### Task 7: `InkCanvas` / `useInkCanvas` draw through the camera

**Files:**
- Modify: `src/ink/useInkCanvas.ts`, `src/ink/InkCanvas.tsx`, `src/ink/InkEditorOverlay.tsx`, `src/ink/ruler.ts` (`centredRuler` takes the viewport's world centre), `src/index.css` (`.ink-editor-body` becomes a non-scrolling fill; drop `.ink-canvas-wrap` page sizing and the CSS grid background; keep `.ink-canvas`'s base colour)
- Delete: `src/ink/useZoomAnchor.ts`, `src/ink/layerCache.ts` + test (reintroduce only if measured necessary); from `bounds.ts` delete `growCanvas`, `scrollShift`, `GROW_MARGIN`, `PAGE_STEP`, `MAX_EXTENT`, `Page` and their tests, plus every `growPage`/`autoGrow` call site in `useInkCanvas.ts` (`cropToContent` goes in Task 8)
- Test: update `useInkCanvas.test.ts`, `inkPenFeel.test.tsx`, `inkEditorOverlay.test.tsx`, `inkCanvasSaved.test.tsx`, `lasso`/`pointEraser`-driven integration tests that used `zoom`/`origin`; delete `inkInfinitePage.test.tsx`, `growCanvas`-dependent tests, `activeCanvas.test.tsx` only if they test removed behaviour

**Interfaces:**
- Consumes: `useCamera`, `camera.ts`.
- Produces: `toInk(e: { clientX: number; clientY: number }, camera: Camera, rect: { left: number; top: number }): { x: number; y: number }` (replaces the `offsetX/zoom/origin` version; still the only pointer→world mapping). `InkCanvas` props become `{ svgPath: string; backdrop?: InkBackdrop; onSaved?: () => void; autoActivate?: boolean }`; `width/height/zoom/onZoomChange/autoGrow/growAllSides` are removed. `CanvasHandle` (`src/store/ink.ts`) keeps `zoom` as `camera.scale` and `setZoom` as `zoomToward`; drop `cropToContent`.

- [ ] **Step 1: Write failing tests:** (a) with a stubbed 2D context recording `setTransform`/`fillStyle` calls, a pointer drag from (100,100) to (200,150) at camera `{x:50,y:0,scale:2}` produces a saved stroke whose points are world `(100,50)`→`(150,75)`; (b) the canvas element's width/height equal the viewport × dpr and do not change after zooming from 1 to 4; (c) strokes entirely outside the viewport are not painted (count `fill` calls with one visible, one far stroke); (d) the text editor `<textarea>` and eraser cursor are positioned by `worldToScreen`; (e) pen stroke, shape, lasso-move and text commits each still produce exactly one history entry and one `inkApi.write`.
- [ ] **Step 2: Run** `npx vitest run src/ink` — expect FAIL.
- [ ] **Step 3: Implement:** canvas fills `.ink-editor-body`; each frame `setTransform(dpr,0,0,dpr,0,0)`, clear, grid (drawn from the camera, skipped when spacing < 4 screen px), optional backdrop image at world `(0,0,width,height)`, then `setTransform(dpr·scale, 0, 0, dpr·scale, −x·dpr·scale, −y·dpr·scale)` and paint only `isVisible` items, then live stroke/shape/lasso/ruler. Pointer handlers read `camera` through a ref so they don't re-bind per frame. Touch: one finger pans via `panBy`; two fingers pinch via `pinchZoom` + `zoomAbout` at the midpoint. The overlay's `+ − 0` keys call `zoomToward(zoomForKey(...))`.
- [ ] **Step 4: Run** `npx vitest run src/ink src/editor` — expect PASS.
- [ ] **Step 5: Commit** `feat(ink): camera-based canvas in the full-screen editor`.

### Task 8: Save the extent; remove the crop action

**Files:**
- Modify: `src/ink/useInkCanvas.ts` (`save`), `src/ink/DrawRibbon.tsx` and `src/editor/toolbar/InkToolGroup.tsx` (remove the crop control — stage only your hunks in `DrawRibbon.tsx`, it has unrelated uncommitted edits), `src/store/ink.ts` (`CanvasHandle`)
- Test: `src/ink/inkCanvasSaved.test.tsx`, `src/ink/DrawRibbon.test.tsx`

**Interfaces:**
- Consumes: `extentOf` (Task 5), `InkBackdrop` (Task 2).
- Produces: `save(data)` writes `backdrop ? { ...data, originX: 0, originY: 0, width: backdrop.width, height: backdrop.height } : extentOf(data)`.

- [ ] **Step 1: Write failing tests:** load a sidecar with `originX: -300, originY: -200` and three strokes → draw one more → the written data's original strokes are deep-equal to the loaded ones and the extent contains all of them; empty drawing → drawing then undoing to empty writes finite extent; backdrop mode writes the page rectangle even with a stroke at (-50, -50).
- [ ] **Step 2: Run** `npx vitest run src/ink/inkCanvasSaved.test.tsx src/ink/DrawRibbon.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement** the `save` change and remove the crop button, its shortcut and `CanvasHandle.cropToContent`.
- [ ] **Step 4: Run** the files — expect PASS.
- [ ] **Step 5: Commit** `feat(ink): extent follows the ink, crop action removed`.

### Task 9: Verify in the real app, update docs

**Files:**
- Modify: `docs/ROADMAP.md`, `docs/plans/ink-infinite-page.md` and `docs/specs/ink-infinite-page-design.md` (add a one-line "superseded by ink-camera" note), any `skills/` page that mentions inline ink or the 8000-unit cap (grep first); run the `sync-agent-docs` skill

- [ ] **Step 1: Run** `npm run typecheck && npm run lint && npm test` — all pass.
- [ ] **Step 2: Run** the `ci-local` skill — all checks pass.
- [ ] **Step 3: Drive the app** with the `e2e-verify` skill: add `e2e/specs/ink-camera.spec.ts` that opens a drawing, Ctrl+wheels at a chosen point and asserts the pixel under it is unchanged (screenshot compare of a marker stroke), pans with the wheel, draws, closes, and sees the preview. Visually inspect the screenshots.
- [ ] **Step 4: Measure** a generated 5,000-stroke drawing: pan for a few seconds in `npm run dev` and note frame cost; if it visibly stutters, reintroduce a committed-layer cache keyed on (inkData, scale) and rebuild only on scale change.
- [ ] **Step 5: Commit** `docs: ink camera supersedes the infinite page`.
