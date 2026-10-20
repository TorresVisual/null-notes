# Ink Infinite Page Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** In the full-screen ink editor the page grows in all four directions as ink approaches an edge, without moving any stored coordinate and without a visible jump.

**Architecture:** `InkData` gains a page origin (`originX`, `originY`) so growing left/up moves the origin instead of translating strokes. `growCanvas` works on full bounds and returns a new `{ originX, originY, width, height }`; `useInkCanvas` maps pointer events through one pure `toInk()` and draws with an origin-subtracting transform; `InkCanvas` compensates the scroll position in a layout effect whenever the origin changes.

**Tech Stack:** React 19 + TypeScript (strict), Canvas 2D, Vitest + Testing Library (jsdom).

**Spec:** `docs/specs/ink-infinite-page-design.md`

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Coordinates of existing ink never change; only the origin moves (spec Non-Goals).
- Inline canvases (canvas notes, PDF pages) keep right/down-only growth: `growAllSides` is passed **only** by `InkEditorOverlay`.
- No truly unbounded viewport, camera or culling renderer (spec Non-Goals).
- Format: `viewBox="originX originY width height"` plus `data-origin-x` / `data-origin-y`; the reader defaults both to `0` so every existing file opens unchanged.
- Growth step: `ceil(needed / PAGE_STEP) × PAGE_STEP` on each side within `GROW_MARGIN` of the edge. The page never shrinks on its own; only undo/redo restores a smaller page.
- Extent cap: 8000 units per axis; at the cap a side stops growing, no extra UI.
- Backing-store scale: `min(dpr · zoom, 16384 / extent, sqrt(64M / (width · height)))`.
- The sidecar `NoteName.ink/*.svg` stays inside the workspace; no storage change (CLAUDE.md "storage boundary").
- TypeScript strict: no `any`, no unexplained `!`. Named exports; no comments unless the WHY is non-obvious.
- `npm run lint` does not exist; verification is `npm run typecheck` and `npm test`.

## Review Focus

Failure modes the spec implies that happy-path tests would not catch, most likely first. Each has a test in the task named in brackets.

1. **A legacy file with ink near the left/top edge must open unchanged.** Taken literally, the spec's reader rule `originX = min(originX, minX − GROW_MARGIN)` would shift every file whose ink sits within 160 units of the edge (`minX = 10` → origin −150). The reader must widen only when content lies *outside* the origin. [Task 2]
2. **Erasing, empty selections and empty pages must not grow the page.** `Bounds` of nothing is `±Infinity`; it must never be read as "near an edge". [Task 1, Task 3]
3. **A drag or paste that overshoots by several steps** must grow enough that the content is no longer inside the margin on the next stroke (no one-step-per-stroke staircase). [Task 3]
4. **Inline canvases must not grow left/up** even though they share the hook. [Task 3]
5. **Undo/redo across a growth** must move the scroll back by the same amount, and opening a file saved with a non-zero origin is an origin change too (the view lands on ink `(0, 0)`, not on the empty grown margin). [Task 6]

---

## File Structure

| File | Change |
|---|---|
| `src/ink/types.ts` | `originX`, `originY` on `InkData` |
| `src/ink/growCanvas.ts` | `Bounds`, `inkBounds`, four-sided `growCanvas` with cap, `scrollShift` |
| `src/ink/lasso.ts`, `src/ink/textBounds.ts` | `selectionReach` → `selectionBounds`, `reachOfTextItem` → `boundsOfTextItem` |
| `src/ink/svgSerialiser.ts` | Write/read origin and `viewBox`; widen origin on load |
| `src/ink/zoom.ts` | `backingScale` |
| `src/ink/ruler.ts` | `centredRuler` takes the page's `originX` |
| `src/ink/useInkCanvas.ts` | `growAllSides`, exported `toInk`, origin-aware transform and growth |
| `src/ink/InkCanvas.tsx` | `growAllSides` prop; origin-aware `pagePoint`, text editor, grid; scroll-compensation layout effect |
| `src/ink/InkEditorOverlay.tsx` | Pass `growAllSides` |
| `src/ink/inkInfinitePage.test.tsx` | Create — integration tests (growth, mapping, grid, scroll) |
| `src/hooks/useCreateCanvasNote.ts`, `src/editor/splitIntoTasks.ts`, `src/editor/toolbar/insertInk.ts` | Add `originX: 0, originY: 0` to their empty-page literals |
| `docs/ROADMAP.md` | Addendum under P13-4 |

Deviations from the spec's file table, with reasons:

- **Scroll compensation lives in `InkCanvas`, not `InkEditorOverlay`.** `InkCanvas` owns `inkData` (and so the origin) and already locates `.ink-editor-body` in `scrollAncestors`; the overlay would need a new callback just to be told what the canvas already knows. The pure offset function is still unit-tested on its own.
- **The eraser cursor needs no change.** It is positioned with `clientX − rect.left` inside the page's own `position: relative` box, which is already page-relative screen space; no ink coordinate is involved. Task 5 leaves it alone.
- **`Reach` becomes `Bounds`** (adds `minX`/`minY`) and its three helpers are renamed (`reachOfPoints` → `boundsOfPoints`, `selectionReach` → `selectionBounds`, `reachOfTextItem` → `boundsOfTextItem`), because `growCanvas` now needs both ends of each axis and a `Reach` with a `min` is misleading.

---

### Task 1: `Bounds` replaces `Reach`

Behaviour-neutral refactor that gives later tasks full bounds. `growCanvas` itself is untouched here except for its parameter type.

**Files:**
- Modify: `src/ink/growCanvas.ts`, `src/ink/lasso.ts`, `src/ink/textBounds.ts`, `src/ink/useInkCanvas.ts`
- Test: `src/ink/growCanvas.test.ts`, `src/ink/lasso.test.ts`, `src/ink/textBounds.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all in `src/ink/growCanvas.ts` unless noted):
  - `interface Bounds { minX: number; minY: number; maxX: number; maxY: number }`
  - `const EMPTY_BOUNDS: Bounds` — `minX/minY = Infinity`, `maxX/maxY = -Infinity`; never within any margin.
  - `boundsOfPoints(points: { x: number; y: number }[]): Bounds`
  - `mergeBounds(a: Bounds, b: Bounds): Bounds`
  - `inkBounds(data: InkData): Bounds` — strokes, shapes (corner points) and texts.
  - `boundsOfTextItem(item: TextItem): Bounds` (in `textBounds.ts`)
  - `selectionBounds(data: InkData, selection: Selection): Bounds` (in `lasso.ts`)

- [ ] **Step 1: Write the failing tests**

In `src/ink/growCanvas.test.ts` replace the import and the `reachOfPoints` block, and add `inkBounds`:

```ts
import { describe, it, expect } from 'vitest'
import { GROW_MARGIN, PAGE_STEP, EMPTY_BOUNDS, boundsOfPoints, inkBounds, growCanvas } from './growCanvas'
import type { InkData } from './types'

describe('boundsOfPoints', () => {
  it('finds the extremes among the points on both axes', () => {
    expect(boundsOfPoints([{ x: 10, y: 500 }, { x: 300, y: 20 }])).toEqual({
      minX: 10, minY: 20, maxX: 300, maxY: 500,
    })
  })

  it('is EMPTY_BOUNDS for no points, which sits inside no margin', () => {
    expect(boundsOfPoints([])).toEqual(EMPTY_BOUNDS)
  })
})

describe('inkBounds', () => {
  const data: InkData = {
    width: 800, height: 600, strokes: [], shapes: [], texts: [],
  }

  it('is EMPTY_BOUNDS for an empty page', () => {
    expect(inkBounds(data)).toEqual(EMPTY_BOUNDS)
  })

  it('covers strokes, shape corners and text, including ink at negative coordinates', () => {
    const bounds = inkBounds({
      ...data,
      strokes: [{ id: 's', points: [{ x: -50, y: 20, pressure: 0.5 }, { x: 10, y: 30, pressure: 0.5 }], color: '#000', size: 2, opacity: 1 }],
      shapes: [{ id: 'r', kind: 'rect', x1: 100, y1: -70, x2: 400, y2: 90, color: '#000', size: 2 }],
      texts: [{ id: 't', x: 5, y: 5, text: 'hi', color: '#000', size: 20 }],
    })
    expect(bounds.minX).toBe(-50)
    expect(bounds.minY).toBe(-70)
    expect(bounds.maxX).toBe(400)
    expect(bounds.maxY).toBeGreaterThanOrEqual(90)
  })
})
```

Keep the existing `growCanvas` describe block but pass full bounds — add this helper above it and wrap every `reach` literal:

```ts
const reach = (maxX: number, maxY: number) => ({ minX: 0, minY: 0, maxX, maxY })
```

(e.g. `growCanvas(800, 600, reach(400, 300), true)`; the "never grows from content near the origin" test becomes `growCanvas(800, 600, EMPTY_BOUNDS, true)`.)

In `src/ink/lasso.test.ts` replace the `selectionReach` import with `selectionBounds` and the final describe with:

```ts
describe('selectionBounds', () => {
  it('reports the extremes the selection covers, on both axes', () => {
    const data: InkData = {
      width: 800,
      height: 600,
      strokes: [stroke('a', [[50, 120], [700, 340]])],
      shapes: [{ ...rect, id: 'r1', x1: 10, x2: 900, y1: 10, y2: 500 }],
      texts: [],
    }
    expect(selectionBounds(data, { strokeIds: ['a'], shapeIds: [] })).toEqual({ minX: 50, minY: 120, maxX: 700, maxY: 340 })
    expect(selectionBounds(data, { strokeIds: [], shapeIds: ['r1'] })).toEqual({ minX: 10, minY: 10, maxX: 900, maxY: 500 })
  })

  it('is EMPTY_BOUNDS for an empty selection', () => {
    const data: InkData = { width: 800, height: 600, strokes: [], shapes: [], texts: [] }
    expect(selectionBounds(data, EMPTY_SELECTION)).toEqual(EMPTY_BOUNDS)
  })
})
```

and add `import { EMPTY_BOUNDS } from './growCanvas'` to that file.

In `src/ink/textBounds.test.ts` replace the `reachOfTextItem` import and describe:

```ts
describe('boundsOfTextItem', () => {
  it("spans from the item's origin to its far corner", () => {
    const bounds = measureTextItem(item)
    expect(boundsOfTextItem(item)).toEqual({
      minX: item.x, minY: item.y, maxX: item.x + bounds.width, maxY: item.y + bounds.height,
    })
  })

  // A multi-line label's bottom edge can cross a grow margin even when the
  // (x, y) it was placed at is nowhere near it.
  it('grows with extra lines even though the origin stays put', () => {
    const multiline = { ...item, text: 'first\nsecond\nthird' }
    expect(boundsOfTextItem(multiline).maxY).toBeGreaterThan(boundsOfTextItem(item).maxY)
    expect(multiline.x).toBe(item.x)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ink/growCanvas.test.ts src/ink/lasso.test.ts src/ink/textBounds.test.ts`
Expected: FAIL — `boundsOfPoints`, `inkBounds`, `EMPTY_BOUNDS`, `selectionBounds`, `boundsOfTextItem` are not exported.

- [ ] **Step 3: Implement**

`src/ink/growCanvas.ts` — keep the existing header comment, constants and `growCanvas` body; replace the `Reach` block and loosen `growCanvas`'s parameter type:

```ts
import { boundsOfTextItem } from './textBounds'
import type { InkData } from './types'

export const GROW_MARGIN = 160
export const PAGE_STEP = 400

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const EMPTY_BOUNDS: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

export function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export function boundsOfPoints(points: { x: number; y: number }[]): Bounds {
  return points.reduce(
    (bounds, p) => mergeBounds(bounds, { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }),
    EMPTY_BOUNDS,
  )
}

export function inkBounds(data: InkData): Bounds {
  let bounds = EMPTY_BOUNDS
  for (const stroke of data.strokes) bounds = mergeBounds(bounds, boundsOfPoints(stroke.points))
  for (const s of data.shapes) {
    bounds = mergeBounds(bounds, boundsOfPoints([{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]))
  }
  for (const item of data.texts) bounds = mergeBounds(bounds, boundsOfTextItem(item))
  return bounds
}

export function growCanvas(
  width: number,
  height: number,
  reach: Pick<Bounds, 'maxX' | 'maxY'>,
  autoGrow: boolean,
): { width: number; height: number } {
  if (!autoGrow) return { width, height }
  return {
    width: reach.maxX > width - GROW_MARGIN ? width + PAGE_STEP : width,
    height: reach.maxY > height - GROW_MARGIN ? height + PAGE_STEP : height,
  }
}
```

`src/ink/textBounds.ts`: change line 1 to `import type { Bounds } from './growCanvas'` and replace `reachOfTextItem`:

```ts
export function boundsOfTextItem(item: TextItem): Bounds {
  const bounds = measureTextItem(item)
  return { minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.width, maxY: bounds.y + bounds.height }
}
```

(Also update the comment above it: "A text item's far corner, not its origin …" stays true; change "reach" wording only if it now reads wrong.)

`src/ink/lasso.ts`: change line 1 to `import { EMPTY_BOUNDS, mergeBounds, boundsOfPoints } from './growCanvas'` + `import type { Bounds } from './growCanvas'` (one import statement with `type Bounds` is fine), and replace `selectionReach` and its comment:

```ts
// The extremes the selection covers on either axis, so a drag towards any edge
// can grow the page instead of pushing ink off it.
export function selectionBounds(data: InkData, selection: Selection): Bounds {
  let bounds = EMPTY_BOUNDS
  for (const stroke of data.strokes) {
    if (selection.strokeIds.includes(stroke.id)) bounds = mergeBounds(bounds, boundsOfPoints(stroke.points))
  }
  for (const shape of data.shapes) {
    if (!selection.shapeIds.includes(shape.id)) continue
    bounds = mergeBounds(bounds, boundsOfPoints([{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }]))
  }
  return bounds
}
```

`src/ink/useInkCanvas.ts` — keep behaviour, rename only:
- import: `import { boundsOfTextItem } from './textBounds'` (was `reachOfTextItem`), `import { EMPTY_BOUNDS, growCanvas, boundsOfPoints } from './growCanvas'` (was `reachOfPoints`), `selectionBounds` (was `selectionReach`) in the `./lasso` import list.
- `reachOfTextItem(item)` → `boundsOfTextItem(item)` (2 sites); `reachOfPoints(` → `boundsOfPoints(` (3 sites); `selectionReach(` → `selectionBounds(` (1 site); the text-drag fallback `{ maxX: 0, maxY: 0 }` → `EMPTY_BOUNDS`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/ink && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ink
git commit -m "refactor(ink): Bounds replaces Reach so growth can see both ends of an axis"
```

---

### Task 2: Page origin in `InkData` and the SVG format

**Files:**
- Modify: `src/ink/types.ts`, `src/ink/svgSerialiser.ts`
- Modify (empty-page literals): `src/hooks/useCreateCanvasNote.ts:12`, `src/editor/splitIntoTasks.ts:33`, `src/editor/toolbar/insertInk.ts:11`, `src/ink/useInkCanvas.ts:217`
- Modify (test literals): `src/ink/lasso.test.ts` (4 existing + the one Task 1 added), `src/ink/pointEraser.test.ts` (3), `src/ink/svgSerialiser.test.ts` (7), `src/ink/growCanvas.test.ts` (the `data` in `inkBounds`), `src/ink/inkCanvasSaved.test.tsx` (`INK_WITH_STROKE`), `src/editor/extensions/inkBlockMount.test.tsx` (`EMPTY`, `WITH_LINE`)
- Test: `src/ink/svgSerialiser.test.ts`

**Interfaces:**
- Consumes: `inkBounds`, `GROW_MARGIN` from Task 1.
- Produces: `InkData.originX: number`, `InkData.originY: number` (required). `svgToInkData` always returns both, widened to cover content that lies outside them while keeping the page's right/bottom edge fixed.

- [ ] **Step 1: Write the failing tests**

Append to `src/ink/svgSerialiser.test.ts` (add `import { sanitizeNoteHtml } from '../lib/sanitizeHtml'` and `import { GROW_MARGIN } from './growCanvas'` at the top):

```ts
describe('page origin', () => {
  const blank: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [], shapes: [], texts: [] }

  it('writes the origin into viewBox and data attributes', () => {
    const svg = inkDataToSvg({ ...blank, originX: -400, originY: -800, width: 1200, height: 1400 })
    expect(svg).toContain('viewBox="-400 -800 1200 1400"')
    expect(svg).toContain('data-origin-x="-400"')
    expect(svg).toContain('data-origin-y="-800"')
  })

  it('round-trips a negative origin', () => {
    const data = { ...blank, originX: -400, originY: -800, width: 1200, height: 1400 }
    const restored = svgToInkData(inkDataToSvg(data))
    expect(restored).toMatchObject({ originX: -400, originY: -800, width: 1200, height: 1400 })
  })

  it('reads a file written before origins existed as origin 0, 0', () => {
    const legacy = `<svg xmlns="http://www.w3.org/2000/svg" data-width="800" data-height="600"></svg>`
    expect(svgToInkData(legacy)).toMatchObject({ originX: 0, originY: 0, width: 800, height: 600 })
  })

  // Review Focus 1: the margin rule must not move files whose ink merely sits
  // near the edge — only ink that lies outside the origin widens it.
  it('leaves a legacy file with ink near the top-left corner exactly as it was', () => {
    const near = inkDataToSvg({ ...blank, strokes: [{ ...stroke, points: [{ x: 10, y: 10, pressure: 0.5 }] }] })
    expect(svgToInkData(near)).toMatchObject({ originX: 0, originY: 0, width: 800, height: 600 })
  })

  it('widens the origin to cover ink outside it, keeping the right and bottom edges fixed', () => {
    const outside = inkDataToSvg({
      ...blank,
      strokes: [{ ...stroke, points: [{ x: -300, y: -50, pressure: 0.5 }, { x: 20, y: 20, pressure: 0.5 }] }],
    })
    const restored = svgToInkData(outside)
    expect(restored.originX).toBe(-300 - GROW_MARGIN)
    expect(restored.originY).toBe(-50 - GROW_MARGIN)
    expect(restored.originX + restored.width).toBe(800)
    expect(restored.originY + restored.height).toBe(600)
  })

  it('is stable: widening a widened file changes nothing', () => {
    const outside = inkDataToSvg({
      ...blank,
      strokes: [{ ...stroke, points: [{ x: -300, y: 20, pressure: 0.5 }, { x: 20, y: 20, pressure: 0.5 }] }],
    })
    const once = svgToInkData(outside)
    expect(svgToInkData(inkDataToSvg(once))).toMatchObject({
      originX: once.originX, originY: once.originY, width: once.width, height: once.height,
    })
  })

  it('survives the preview sanitiser, so InkPreview needs no change', () => {
    const svg = inkDataToSvg({ ...blank, originX: -400, width: 1200 })
    expect(sanitizeNoteHtml(svg)).toContain('viewBox="-400 0 1200 600"')
  })
})
```

Then add `originX: 0, originY: 0,` to every typed `InkData` literal listed under **Files** (put it before `width`). `npm run typecheck` after Step 3 lists any that were missed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ink/svgSerialiser.test.ts`
Expected: FAIL — `viewBox` is still `0 0 …`, no `data-origin-x`, origin is `undefined`.

- [ ] **Step 3: Implement**

`src/ink/types.ts` — in `InkData`, above `width`:

```ts
export interface InkData {
  /** The page's top-left in ink coordinates. Growing left/up moves these, never the ink. */
  originX: number
  originY: number
  width: number
  height: number
  strokes: Stroke[]
  shapes: Shape[]
  texts: TextItem[]
}
```

`src/ink/svgSerialiser.ts`:

```ts
import { GROW_MARGIN, inkBounds } from './growCanvas'
```

In `inkDataToSvg` replace the `<svg …>` line:

```ts
  return `<svg xmlns="http://www.w3.org/2000/svg" data-origin-x="${data.originX}" data-origin-y="${data.originY}" data-width="${data.width}" data-height="${data.height}" width="${data.width}" height="${data.height}" viewBox="${data.originX} ${data.originY} ${data.width} ${data.height}">
```

Add above `svgToInkData`:

```ts
// Older builds rewrite the header as `0 0 w h` but keep every stroke, so a file
// that grew leftward and was then saved by one comes back with ink outside its
// page. Only ink actually outside the origin moves it; merely being near the
// edge must not, or every existing note would shift on first open. The right
// and bottom edges stay where they were.
function coverContent(data: InkData): InkData {
  const { minX, minY } = inkBounds(data)
  let { originX, originY, width, height } = data
  if (minX < originX) {
    const next = minX - GROW_MARGIN
    width += originX - next
    originX = next
  }
  if (minY < originY) {
    const next = minY - GROW_MARGIN
    height += originY - next
    originY = next
  }
  return { ...data, originX, originY, width, height }
}
```

In `svgToInkData` read the origin next to width/height and widen at the return:

```ts
  const originX = Number(root?.getAttribute('data-origin-x') ?? 0)
  const originY = Number(root?.getAttribute('data-origin-y') ?? 0)
  …
  return coverContent({ originX, originY, width, height, strokes, shapes, texts })
```

Empty-page literals — add `originX: 0, originY: 0,` before `width` in `useCreateCanvasNote.ts` (`EMPTY_PAGE`), `splitIntoTasks.ts:33`, `insertInk.ts` (`EMPTY_INK`) and the `useState<InkData>` initialiser at `useInkCanvas.ts:217`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS. If a test asserting a full written `InkData` with `toEqual` now fails on the missing origin, add the two fields to its expected value.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(ink): page origin in InkData and the sidecar SVG header"
```

---

### Task 3: Four-sided growth with a size cap

**Files:**
- Modify: `src/ink/growCanvas.ts`, `src/ink/useInkCanvas.ts`, `src/ink/InkCanvas.tsx` (prop pass-through only)
- Test: `src/ink/growCanvas.test.ts` (rewrite the `growCanvas` block), `src/ink/inkInfinitePage.test.tsx` (create)

**Interfaces:**
- Consumes: `Bounds`, `EMPTY_BOUNDS`, `boundsOfPoints`, `boundsOfTextItem`, `selectionBounds` (Task 1); `InkData.originX/originY` (Task 2).
- Produces:
  - `interface Page { originX: number; originY: number; width: number; height: number }` and `const MAX_EXTENT = 8000` in `growCanvas.ts`.
  - `growCanvas(page: Page, bounds: Bounds, autoGrow: boolean, growAllSides: boolean): Page` — `autoGrow` false returns `page` unchanged; `growAllSides` false never moves the origin.
  - `useInkCanvas` option `growAllSides?: boolean`; `InkCanvas` prop `growAllSides?: boolean`.
  - Test helpers in `inkInfinitePage.test.tsx`: `mountCanvas(props?)` and `at(canvas, type, x, y)` — reused by Tasks 4–6.

- [ ] **Step 1: Write the failing tests**

Replace the `growCanvas` describe block in `src/ink/growCanvas.test.ts` (drop the `reach` helper from Task 1; update the import to `GROW_MARGIN, PAGE_STEP, MAX_EXTENT, EMPTY_BOUNDS, boundsOfPoints, inkBounds, growCanvas`):

```ts
const page = { originX: 0, originY: 0, width: 800, height: 600 }
const bounds = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY })
const inside = bounds(300, 300, 400, 400)

describe('growCanvas', () => {
  it('leaves the page alone when nothing is near an edge', () => {
    expect(growCanvas(page, inside, true, true)).toEqual(page)
  })

  it('does nothing when autoGrow is off, however far the ink reaches', () => {
    expect(growCanvas(page, bounds(-9000, -9000, 9000, 9000), false, true)).toEqual(page)
  })

  it('grows right and down by one step, as before, without growAllSides', () => {
    expect(growCanvas(page, bounds(300, 300, 800 - GROW_MARGIN + 1, 400), true, false))
      .toEqual({ ...page, width: 800 + PAGE_STEP })
    expect(growCanvas(page, bounds(300, 300, 400, 600 - GROW_MARGIN + 1), true, false))
      .toEqual({ ...page, height: 600 + PAGE_STEP })
  })

  // Review Focus 4: inline canvases share the hook and must keep a fixed origin.
  it('never moves the origin without growAllSides', () => {
    expect(growCanvas(page, bounds(-500, -500, 400, 400), true, false)).toEqual(page)
  })

  it('grows left and up by moving the origin, leaving the far edges where they were', () => {
    expect(growCanvas(page, bounds(GROW_MARGIN - 1, 300, 400, 400), true, true))
      .toEqual({ originX: -PAGE_STEP, originY: 0, width: 800 + PAGE_STEP, height: 600 })
    expect(growCanvas(page, bounds(300, GROW_MARGIN - 1, 400, 400), true, true))
      .toEqual({ originX: 0, originY: -PAGE_STEP, width: 800, height: 600 + PAGE_STEP })
  })

  it('treats the margin boundary as inside: exactly GROW_MARGIN from the edge does not grow', () => {
    expect(growCanvas(page, bounds(GROW_MARGIN, GROW_MARGIN, 800 - GROW_MARGIN, 600 - GROW_MARGIN), true, true))
      .toEqual(page)
  })

  it('grows every side at once', () => {
    expect(growCanvas(page, bounds(0, 0, 800, 600), true, true)).toEqual({
      originX: -PAGE_STEP, originY: -PAGE_STEP, width: 800 + 2 * PAGE_STEP, height: 600 + 2 * PAGE_STEP,
    })
  })

  // Review Focus 3: a lasso drag or paste can overshoot by several steps.
  it('grows several steps at once for an overshoot, enough to clear the margin', () => {
    const grown = growCanvas(page, bounds(-1000, 300, 400, 400), true, true)
    expect(grown.originX).toBe(-3 * PAGE_STEP)
    expect(grown.width).toBe(800 + 3 * PAGE_STEP)
    expect(-1000).toBeGreaterThan(grown.originX + GROW_MARGIN - 1)
  })

  // Review Focus 2
  it('does not grow for empty bounds', () => {
    expect(growCanvas(page, EMPTY_BOUNDS, true, true)).toEqual(page)
  })

  it('stops a side at the extent cap', () => {
    const wide = { ...page, width: MAX_EXTENT }
    expect(growCanvas(wide, bounds(0, 300, MAX_EXTENT, 400), true, true)).toEqual(wide)
  })

  it('shares the remaining room, low side first, when both sides want more than fits', () => {
    const nearCap = { ...page, width: MAX_EXTENT - PAGE_STEP }
    const grown = growCanvas(nearCap, bounds(0, 300, MAX_EXTENT - PAGE_STEP, 400), true, true)
    expect(grown.originX).toBe(-PAGE_STEP)
    expect(grown.width).toBe(MAX_EXTENT)
  })

  it('does not shrink a page that is already past the cap', () => {
    const huge = { ...page, width: 9000 }
    expect(growCanvas(huge, bounds(0, 300, 9000, 400), true, true)).toEqual(huge)
  })
})
```

Create `src/ink/inkInfinitePage.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, createEvent, fireEvent, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { InkCanvas } from './InkCanvas'
import { useInkStore } from '../store/ink'
import { DEFAULT_PENS } from './pens'
import type { InkData } from './types'

const write = vi.fn<(path: string, data: InkData) => Promise<void>>().mockResolvedValue(undefined)
const read = vi.fn<(path: string) => Promise<InkData | null>>().mockResolvedValue(null)

vi.mock('../lib/ink', () => ({
  inkApi: {
    ensureDir: () => Promise.resolve('/ws/N.ink'),
    read: (path: string) => read(path),
    write: (path: string, data: InkData) => write(path, data),
  },
}))

const SRC = '/ws/N.ink/a.svg'

beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined)
  read.mockReset().mockResolvedValue(null)
  useInkStore.setState({
    tool: 'rect',
    pens: DEFAULT_PENS,
    activePenId: DEFAULT_PENS[0].id,
    eraserMode: 'point',
    eraserSize: 12,
    textSize: 18,
    activeCanvas: null,
    activeCanvasId: null,
  })
})
afterEach(cleanup)

const PAGE: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [], shapes: [], texts: [] }

// jsdom computes no offsetX/offsetY, so page coordinates are set by hand.
function at(canvas: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) {
  const event = createEvent[type](canvas, { pointerType: 'pen', pointerId: 1 })
  Object.defineProperty(event, 'offsetX', { value: x })
  Object.defineProperty(event, 'offsetY', { value: y })
  fireEvent(canvas, event)
}

async function mountCanvas(props: Partial<ComponentProps<typeof InkCanvas>> = {}, loaded: InkData = PAGE) {
  read.mockResolvedValue(loaded)
  const view = render(<InkCanvas svgPath={SRC} width={800} height={600} {...props} />)
  await waitFor(() => expect(read).toHaveBeenCalled())
  await new Promise((resolve) => setTimeout(resolve, 0))
  const canvas = view.container.querySelector('canvas')!
  return { ...view, canvas }
}

function drawRect(canvas: Element, x1: number, y1: number, x2: number, y2: number) {
  at(canvas, 'pointerDown', x1, y1)
  at(canvas, 'pointerUp', x2, y2)
}

function lastWrite(): InkData {
  const call = write.mock.calls[write.mock.calls.length - 1]
  if (!call) throw new Error('nothing written')
  return call[1]
}

describe('growing in every direction', () => {
  it('moves the origin, not the ink, when a shape nears the left and top edges', async () => {
    const { canvas } = await mountCanvas({ autoGrow: true, growAllSides: true })
    drawRect(canvas, 50, 50, 300, 300)

    const saved = lastWrite()
    expect(saved).toMatchObject({ originX: -400, originY: -400, width: 1200, height: 1000 })
    expect(saved.shapes[0]).toMatchObject({ x1: 50, y1: 50, x2: 300, y2: 300 })
  })

  it('keeps a fixed origin without growAllSides', async () => {
    const { canvas } = await mountCanvas({ autoGrow: true })
    drawRect(canvas, 50, 50, 300, 300)

    expect(lastWrite()).toMatchObject({ originX: 0, originY: 0, width: 800, height: 600 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ink/growCanvas.test.ts src/ink/inkInfinitePage.test.tsx`
Expected: FAIL — `MAX_EXTENT` missing, `growCanvas` still takes `(width, height, reach, autoGrow)`.

- [ ] **Step 3: Implement**

`src/ink/growCanvas.ts` — replace the old header comment and `growCanvas`:

```ts
// The page grows on a side when ink comes within GROW_MARGIN of it. Right and
// down just make the box bigger; left and up move the page's origin instead,
// so no stored coordinate is ever translated (see ink-infinite-page-design.md).
// Only the full-screen editor asks for all four sides — inline canvases and PDF
// pages keep a fixed origin.
export const GROW_MARGIN = 160
export const PAGE_STEP = 400
export const MAX_EXTENT = 8000

export interface Page {
  originX: number
  originY: number
  width: number
  height: number
}
```

(keep `Bounds`, `EMPTY_BOUNDS`, `mergeBounds`, `boundsOfPoints`, `inkBounds` from Task 1, and the `GROW_MARGIN`/`PAGE_STEP` constants only once), then:

```ts
function stepsFor(needed: number): number {
  return needed > 0 ? Math.ceil(needed / PAGE_STEP) * PAGE_STEP : 0
}

function growAxis(origin: number, size: number, min: number, max: number, growStart: boolean) {
  const room = Math.max(0, Math.floor((MAX_EXTENT - size) / PAGE_STEP) * PAGE_STEP)
  const start = growStart ? Math.min(stepsFor(origin + GROW_MARGIN - min), room) : 0
  const end = Math.min(stepsFor(max - (origin + size - GROW_MARGIN)), room - start)
  return { origin: origin - start, size: size + start + end }
}

export function growCanvas(page: Page, bounds: Bounds, autoGrow: boolean, growAllSides: boolean): Page {
  if (!autoGrow) return page
  const x = growAxis(page.originX, page.width, bounds.minX, bounds.maxX, growAllSides)
  const y = growAxis(page.originY, page.height, bounds.minY, bounds.maxY, growAllSides)
  return { originX: x.origin, originY: y.origin, width: x.size, height: y.size }
}
```

`±Infinity` bounds fall out as "no growth" (`stepsFor(-Infinity)` is `0`). Whole steps only at the cap, so a 700-wide note stops at 7900, an 800-wide one at 8000.

`src/ink/useInkCanvas.ts`:

1. `InkOptions` gains `growAllSides?: boolean`; the destructure becomes `{ zoom = 1, autoGrow = false, growAllSides = false, onSaved }`.
2. After `save`, add:

```ts
  const growPage = useCallback(
    (data: InkData, bounds: Bounds) => growCanvas(data, bounds, autoGrow, growAllSides),
    [autoGrow, growAllSides],
  )
```

   and import `type Bounds` from `./growCanvas`.
3. Replace the six growth sites (each currently destructures `{ width, height }` or `shapeGrown` from the old `growCanvas`):

   - `commitEditingText`, new item:
     ```ts
     commit({ ...inkData, ...growPage(inkData, boundsOfTextItem(item)), texts: [...inkData.texts, item] })
     ```
     and swap `autoGrow` for `growPage` in its dependency array.
   - Text drag (`handlePointerUp`):
     ```ts
     const item = inkData.texts.find((t) => t.id === textFrom.id)
     const grown = { ...inkData, ...growPage(inkData, item ? boundsOfTextItem(item) : EMPTY_BOUNDS) }
     setInkData(grown)
     save(grown)
     ```
     (replaces the `item`/`reach`/`growCanvas`/`grown` lines; the `setHistory`/`setFuture` lines above stay).
   - Lasso drag: `const grown = { ...inkData, ...growPage(inkData, selectionBounds(inkData, selection)) }`.
   - Shape tool: `commit({ ...inkData, ...growPage(inkData, boundsOfPoints(corners)), shapes: [...inkData.shapes, shape] })`.
   - Straightened stroke: `commit({ ...inkData, ...growPage(inkData, boundsOfPoints([{ x: straight.x1, y: straight.y1 }, { x: straight.x2, y: straight.y2 }])), shapes: [...inkData.shapes, shape] })`.
   - Freehand stroke: `commit({ ...inkData, ...growPage(inkData, boundsOfPoints(stroke.points)), strokes: [...inkData.strokes, stroke] })`.
   - In `handlePointerUp`'s dependency array replace `autoGrow` with `growPage`.

`src/ink/InkCanvas.tsx`: add `growAllSides?: boolean` to `InkCanvasProps`, default `false` in the destructure, and pass it: `useInkCanvas(svgPath, width, height, { zoom, autoGrow, growAllSides, onSaved })`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(ink): grow the page on all four sides by moving its origin"
```

---

### Task 4: Pointer mapping and draw transform honour the origin

**Files:**
- Modify: `src/ink/useInkCanvas.ts`, `src/ink/zoom.ts`
- Test: `src/ink/useInkCanvas.test.ts`, `src/ink/zoom.test.ts`, `src/ink/inkInfinitePage.test.tsx`

**Interfaces:**
- Consumes: `InkData.originX/originY` (Task 2); `mountCanvas`, `at`, `drawRect`, `lastWrite` (Task 3).
- Produces:
  - `toInk(e: { offsetX: number; offsetY: number }, zoom: number, origin: { originX: number; originY: number }): { x: number; y: number }` exported from `useInkCanvas.ts`.
  - `backingScale(dpr: number, zoom: number, width: number, height: number): number`, `MAX_CANVAS_DIMENSION = 16384`, `MAX_CANVAS_PIXELS = 64_000_000` exported from `zoom.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/ink/useInkCanvas.test.ts` add `toInk` to the import and append:

```ts
describe('toInk', () => {
  it('divides by zoom, then adds the page origin', () => {
    expect(toInk({ offsetX: 200, offsetY: 100 }, 2, { originX: -400, originY: -50 })).toEqual({ x: -300, y: 0 })
  })

  it('is plain offset / zoom for a page at the origin', () => {
    expect(toInk({ offsetX: 90, offsetY: 30 }, 1.5, { originX: 0, originY: 0 })).toEqual({ x: 60, y: 20 })
  })
})
```

Create or append in `src/ink/zoom.test.ts` (add `backingScale`, `MAX_CANVAS_DIMENSION`, `MAX_CANVAS_PIXELS` to its import):

```ts
describe('backingScale', () => {
  it('is dpr × zoom for an ordinary page', () => {
    expect(backingScale(2, 1.5, 800, 600)).toBe(3)
  })

  it('is capped by the per-axis canvas limit for a long strip', () => {
    expect(backingScale(4, 1, 8000, 1000)).toBeCloseTo(MAX_CANVAS_DIMENSION / 8000)
  })

  it('is capped by the pixel budget for a big square page', () => {
    const scale = backingScale(2, 1, 8000, 8000)
    expect(scale).toBeCloseTo(Math.sqrt(MAX_CANVAS_PIXELS / (8000 * 8000)))
    expect(8000 * scale * 8000 * scale).toBeLessThanOrEqual(MAX_CANVAS_PIXELS * 1.0001)
  })
})
```

Append to `src/ink/inkInfinitePage.test.tsx`:

```tsx
describe('pointer mapping', () => {
  const GROWN: InkData = { ...PAGE, originX: -400, originY: -200, width: 1200, height: 800 }

  it('adds the origin to every pointer position', async () => {
    const { canvas } = await mountCanvas({ autoGrow: true, growAllSides: true }, GROWN)
    drawRect(canvas, 500, 400, 700, 500)

    expect(lastWrite().shapes[0]).toMatchObject({ x1: 100, y1: 200, x2: 300, y2: 300 })
  })

  it('divides by zoom before adding the origin', async () => {
    const { canvas } = await mountCanvas({ autoGrow: true, growAllSides: true, zoom: 2 }, GROWN)
    drawRect(canvas, 1000, 800, 1400, 1000)

    expect(lastWrite().shapes[0]).toMatchObject({ x1: 100, y1: 200, x2: 300, y2: 300 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ink/useInkCanvas.test.ts src/ink/zoom.test.ts src/ink/inkInfinitePage.test.tsx`
Expected: FAIL — `toInk` and `backingScale` not exported; saved shape is at `x1: 500`.

- [ ] **Step 3: Implement**

`src/ink/zoom.ts`:

```ts
export const MAX_CANVAS_DIMENSION = 16384
export const MAX_CANVAS_PIXELS = 64_000_000

// A canvas has a per-axis size limit and, in practice, a memory budget: an
// 8000 × 8000 page at dpr 2 would be ~1 GB of RGBA. Past either, sharpness drops
// rather than the canvas failing to render.
export function backingScale(dpr: number, zoom: number, width: number, height: number): number {
  return Math.min(
    dpr * zoom,
    MAX_CANVAS_DIMENSION / Math.max(width, height),
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
  )
}
```

`src/ink/useInkCanvas.ts`:

Above `isShapeTool` add:

```ts
interface OffsetPoint {
  offsetX: number
  offsetY: number
}

export function toInk(
  e: OffsetPoint,
  zoom: number,
  origin: { originX: number; originY: number },
): { x: number; y: number } {
  return { x: e.offsetX / zoom + origin.originX, y: e.offsetY / zoom + origin.originY }
}
```

Inside the hook, after the `inkData` state, add (and import `useMemo`):

```ts
  const origin = useMemo(
    () => ({ originX: inkData.originX, originY: inkData.originY }),
    [inkData.originX, inkData.originY],
  )
```

`handlePointerDown` — add `const at = toInk(e, zoom, origin)` right after the `pointerType` guard and replace the `e.offset… / zoom` sites:

- `grabRuler(e.offsetX / zoom, e.offsetY / zoom)` → `grabRuler(at.x, at.y)`
- eraser: `eraseAt(e.offsetX / zoom, e.offsetY / zoom)` → `eraseAt(at.x, at.y)`
- text: delete the two `const x/y = e.offset…` lines and write `const { x, y } = at`
- lasso: same, `const { x, y } = at`
- shape start: `shapeStart.current = { x: at.x, y: at.y }`
- stroke start: `const start = { x: at.x, y: at.y, pressure: e.pressure }`
- add `origin` to the dependency array.

`handlePointerMove` — add `const at = toInk(e, zoom, origin)` after `activeTool`, then:

- `dragRuler(e.offsetX / zoom, e.offsetY / zoom)` → `dragRuler(at.x, at.y)`
- eraser: `eraseAt(at.x, at.y)`
- text and lasso: replace the two `const x/y = e.offset…` lines with `const { x, y } = at`
- shape preview: `x2: at.x, y2: at.y`
- coalesced events: `currentStroke.current.push({ ...toInk(ce, zoom, origin), pressure: ce.pressure })`
- add `origin` to the dependency array.

`handlePointerUp` — in the `if (shapeStart.current)` block add `const end = toInk(e, zoom, origin)` first and use `x2: end.x, y2: end.y`; add `origin` to the dependency array.

`redrawCanvas` — replace the `dpr`/size/transform/clear block:

```ts
      const scale = backingScale(window.devicePixelRatio || 1, zoom, inkData.width, inkData.height)
      const pixelWidth = Math.round(inkData.width * scale)
      const pixelHeight = Math.round(inkData.height * scale)
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      ctx.setTransform(scale, 0, 0, scale, -inkData.originX * scale, -inkData.originY * scale)
      ctx.clearRect(inkData.originX, inkData.originY, inkData.width, inkData.height)
```

keeping the "Back the canvas with real device pixels …" comment above it; import `backingScale` from `./zoom`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(ink): map pointers and draw through the page origin, clamp backing store"
```

---

### Task 5: `InkCanvas` — touch, text editor, grid and ruler follow the origin

**Files:**
- Modify: `src/ink/InkCanvas.tsx`, `src/ink/ruler.ts`, `src/ink/useInkCanvas.ts`
- Test: `src/ink/ruler.test.ts`, `src/ink/inkInfinitePage.test.tsx`

**Interfaces:**
- Consumes: `toInk` (Task 4); `mountCanvas`, `at` (Task 3).
- Produces: `centredRuler(width: number, height: number, originX = 0): Ruler`.

- [ ] **Step 1: Write the failing tests**

In `src/ink/ruler.test.ts`, inside `describe('centredRuler')`:

```ts
  it('centres horizontally on the page, wherever its origin is', () => {
    expect(centredRuler(1200, 600, -400)).toMatchObject({ x: 200, y: 300 })
  })
```

Append to `src/ink/inkInfinitePage.test.tsx`:

```tsx
describe('rendering at a non-zero origin', () => {
  const GROWN: InkData = { ...PAGE, originX: -400, originY: 0, width: 1200, height: 600 }

  it('places the label editor at the text position minus the origin', async () => {
    useInkStore.setState({ tool: 'text' })
    const { canvas, container } = await mountCanvas({ autoGrow: true, growAllSides: true }, GROWN)
    at(canvas, 'pointerDown', 500, 100)
    at(canvas, 'pointerUp', 500, 100)

    const editor = await waitFor(() => {
      const el = container.querySelector<HTMLTextAreaElement>('textarea.ink-text-editor')
      if (!el) throw new Error('editor not open')
      return el
    })
    expect(editor.style.left).toBe('500px')
    expect(editor.style.top).toBe('100px')
  })

  it('keeps the grid aligned to ink coordinates', async () => {
    const { canvas } = await mountCanvas({ zoom: 2 }, GROWN)
    expect(canvas.style.backgroundPosition).toBe('800px 0px')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ink/ruler.test.ts src/ink/inkInfinitePage.test.tsx`
Expected: FAIL — ruler `x` is `600`; editor `left` is `100px`; `backgroundPosition` is empty.

- [ ] **Step 3: Implement**

`src/ink/ruler.ts`:

```ts
export function centredRuler(width: number, height: number, originX = 0): Ruler {
  return { x: originX + width / 2, y: height / 2, angle: 0, length: DEFAULT_RULER_LENGTH }
}
```

`src/ink/useInkCanvas.ts` `toggleRuler`:

```ts
  const toggleRuler = useCallback(() => {
    setRuler((current) => (current ? null : centredRuler(inkData.width, height, inkData.originX)))
  }, [inkData.width, inkData.originX, height])
```

`src/ink/InkCanvas.tsx`:

```ts
  function pagePoint(target: HTMLElement, clientX: number, clientY: number) {
    const rect = target.getBoundingClientRect()
    return toInk({ offsetX: clientX - rect.left, offsetY: clientY - rect.top }, zoom, inkData)
  }
```

(import `toInk` alongside `isEraserTip`), the canvas style gains

```tsx
            backgroundPosition: `${-inkData.originX * zoom}px ${-inkData.originY * zoom}px`,
```

and the text editor's position becomes

```tsx
              left: (editingText.x - inkData.originX) * zoom,
              top: (editingText.y - inkData.originY) * zoom,
```

The eraser cursor stays as is (see Deviations).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(ink): text editor, grid, touch and ruler follow the page origin"
```

---

### Task 6: No visual jump — scroll compensation, overlay opt-in

**Files:**
- Modify: `src/ink/growCanvas.ts`, `src/ink/InkCanvas.tsx`, `src/ink/InkEditorOverlay.tsx`
- Test: `src/ink/growCanvas.test.ts`, `src/ink/inkInfinitePage.test.tsx`, `src/ink/inkEditorOverlay.test.tsx`

**Interfaces:**
- Consumes: `Page` (Task 3); `mountCanvas`, `at`, `drawRect`, `lastWrite` (Task 3).
- Produces: `scrollShift(prev: { originX: number; originY: number }, next: { originX: number; originY: number }, zoom: number): { dx: number; dy: number }` in `growCanvas.ts` — the amount to add to the scroll container's `scrollLeft`/`scrollTop`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ink/growCanvas.test.ts` (add `scrollShift` to the import):

```ts
describe('scrollShift', () => {
  it('advances the scroll by the new space added before the ink, at zoom', () => {
    expect(scrollShift({ originX: 0, originY: 0 }, { originX: -400, originY: -800 }, 2)).toEqual({ dx: 800, dy: 1600 })
  })

  it('goes back by the same amount when undo restores the old origin', () => {
    expect(scrollShift({ originX: -400, originY: 0 }, { originX: 0, originY: 0 }, 2)).toEqual({ dx: -800, dy: 0 })
  })

  it('is zero when the origin did not move', () => {
    expect(scrollShift({ originX: -400, originY: 0 }, { originX: -400, originY: 0 }, 1.5)).toEqual({ dx: 0, dy: 0 })
  })
})
```

Append to `src/ink/inkInfinitePage.test.tsx`:

```tsx
describe('scroll compensation', () => {
  function withScroll(el: HTMLElement) {
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true })
    Object.defineProperty(el, 'scrollLeft', { value: 0, writable: true })
    return el
  }

  async function mountInBody(props: Partial<ComponentProps<typeof InkCanvas>>, loaded: InkData = PAGE) {
    read.mockResolvedValue(loaded)
    const view = render(
      <div className="ink-editor-body">
        <InkCanvas svgPath={SRC} width={800} height={600} {...props} />
      </div>,
    )
    const body = withScroll(view.container.firstElementChild as HTMLElement)
    await waitFor(() => expect(read).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    return { ...view, body, canvas: view.container.querySelector('canvas')! }
  }

  it('advances the scroll when growth adds space before the ink', async () => {
    const { body, canvas } = await mountInBody({ autoGrow: true, growAllSides: true, zoom: 2 })
    drawRect(canvas, 100, 100, 600, 600)

    await waitFor(() => expect(body.scrollLeft).toBe(800))
    expect(body.scrollTop).toBe(800)
  })

  it('moves the scroll back on undo', async () => {
    const { body, canvas } = await mountInBody({ autoGrow: true, growAllSides: true, zoom: 2 })
    drawRect(canvas, 100, 100, 600, 600)
    await waitFor(() => expect(body.scrollLeft).toBe(800))

    useInkStore.getState().activeCanvas?.undo()

    await waitFor(() => expect(body.scrollLeft).toBe(0))
    expect(body.scrollTop).toBe(0)
  })

  // Review Focus 5: opening a file that was saved with a non-zero origin is an
  // origin change too; the view lands on ink (0, 0), not on the empty margin.
  it('lands on ink (0, 0) when a grown file is opened', async () => {
    const { body } = await mountInBody({ autoGrow: true, growAllSides: true, zoom: 1 }, {
      ...PAGE, originX: -400, originY: -400, width: 1200, height: 1000,
    })
    await waitFor(() => expect(body.scrollLeft).toBe(400))
    expect(body.scrollTop).toBe(400)
  })

})
```

Append to `src/ink/inkEditorOverlay.test.tsx` (its `mount()` helper renders `InkEditorOverlay` with `src`, `width={700}`, `height={400}`; `read` there resolves `null`):

```tsx
describe('infinite page', () => {
  it('grows left and up when ink nears the top-left corner', async () => {
    useInkStore.setState({ tool: 'rect' })
    mount()
    const canvas = document.querySelector('canvas')!
    const at = (type: 'pointerDown' | 'pointerUp', x: number, y: number) => {
      const event = createEvent[type](canvas, { pointerType: 'pen', pointerId: 1 })
      Object.defineProperty(event, 'offsetX', { value: x })
      Object.defineProperty(event, 'offsetY', { value: y })
      fireEvent(canvas, event)
    }
    at('pointerDown', 40, 40)
    at('pointerUp', 200, 200)

    await waitFor(() => expect(write).toHaveBeenCalled())
    expect(write.mock.calls[0]?.[1]).toMatchObject({ originX: -400, originY: -400 })
  })
})
```

(add `createEvent` to that file's `@testing-library/react` import.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ink`
Expected: FAIL — `scrollShift` not exported; scroll stays `0`; the overlay's origin stays `0`.

- [ ] **Step 3: Implement**

`src/ink/growCanvas.ts`:

```ts
// Growing left or up adds screen space *before* the existing ink, so the scroll
// position has to advance by the same amount or everything drawn jumps. Keyed on
// any origin change — undo and redo restore the old origin and so shift back.
export function scrollShift(
  prev: { originX: number; originY: number },
  next: { originX: number; originY: number },
  zoom: number,
): { dx: number; dy: number } {
  return { dx: (prev.originX - next.originX) * zoom, dy: (prev.originY - next.originY) * zoom }
}
```

`src/ink/InkCanvas.tsx` — import `useLayoutEffect` and `scrollShift`; add a ref on the page box and the effect after `cursorPos`:

```tsx
  const pageRef = useRef<HTMLDivElement>(null)
  const lastOrigin = useRef({ originX: inkData.originX, originY: inkData.originY })

  useLayoutEffect(() => {
    const { dx, dy } = scrollShift(lastOrigin.current, inkData, zoom)
    lastOrigin.current = { originX: inkData.originX, originY: inkData.originY }
    const body = pageRef.current?.closest('.ink-editor-body')
    if (!body || (dx === 0 && dy === 0)) return
    body.scrollLeft += dx
    body.scrollTop += dy
  }, [inkData.originX, inkData.originY])
```

and `ref={pageRef}` on the `position: 'relative'` div. `zoom` is deliberately not a dependency: the effect must fire only when the origin moves, and it reads the `zoom` of that same render.

`src/ink/InkEditorOverlay.tsx`: add `growAllSides` next to `autoGrow` on the `<InkCanvas …>`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(ink): full-screen editor grows on all sides with scroll compensation"
```

---

### Task 7: Record the decision and verify in the app

**Files:**
- Modify: `docs/ROADMAP.md` (addendum directly under the P13-4 "Done" paragraph, before `## Phase 14`)

- [ ] **Step 1: Add the ROADMAP addendum**

Insert before `## Phase 14 — Diagram Templates (P14) ✅`:

```markdown
**Addendum (2026-10-20): the full-screen editor now grows on all four sides.** The decision above priced left/up growth as "translate every coordinate and compensate the scroll". The page origin removes the first half: `InkData` carries `originX`/`originY`, growth moves the origin instead of the ink, and a layout effect advances the scroll by `Δorigin × zoom` so nothing visibly jumps (undo/redo and opening a grown file are origin changes too). Inline canvases and PDF pages keep right/down-only growth and a fixed origin. Extent is capped at 8000 per axis and the canvas backing store is clamped, so this is still a bounded page, not the unbounded whiteboard §1 ruled out. Spec: `docs/specs/ink-infinite-page-design.md`.
```

- [ ] **Step 2: Full automated check**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Manual QA in `npm run tauri dev`**

Open a note, insert an ink block (opens the full-screen editor), then confirm each:

1. Draw within 160 units of the left edge → the page grows left; nothing already drawn moves on screen.
2. Same for the top edge, and for a stroke near a corner (both axes at once).
3. Ctrl+Z after a left growth → the view moves back with the page; Ctrl+Y re-applies.
4. Lasso-drag a selection far past the left edge → grows several steps in one go.
5. Zoom to 2× and repeat 1–2 → still no jump.
6. Click Done: the in-note preview shows the whole grown page, positions unchanged. Reload the app: ink and preview still match, and the editor opens on the original top-left area.
7. Open an old canvas note and a PDF page's ink overlay: neither grows left/up.
8. Grid lines stay locked to the ink when the page grows left.

- [ ] **Step 4: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: record all-sides growth for the full-screen ink editor"
```

---

## Self-Review

- **Spec coverage:** Format (T2), Growth incl. multi-step and `growAllSides` (T3), never-shrink (T3 — no code path shrinks; undo test T6), Coordinate mapping incl. `pagePoint`, text editor, grid, `centredRuler` (T4, T5; eraser cursor justified in Deviations), No visual jump (T6), Size cap and backing-store clamp (T3, T4), Preview (T2 sanitiser test). Testing list: growCanvas sides/margin/overshoot/cap (T3), serialiser round-trip/legacy/widening (T2), `toInk` (T4), scale clamp (T4), scroll offset math incl. undo (T6), manual QA + typecheck/test (T7).
- **Placeholders:** none; every code step carries the code.
- **Type consistency:** `Bounds`, `EMPTY_BOUNDS`, `boundsOfPoints`, `boundsOfTextItem`, `selectionBounds`, `inkBounds`, `Page`, `growCanvas(page, bounds, autoGrow, growAllSides)`, `growPage`, `toInk(e, zoom, origin)`, `backingScale`, `scrollShift` are used with identical names and signatures across tasks.
- **Review Focus:** items 1–5 map to tests in Tasks 1–3 and 6.
