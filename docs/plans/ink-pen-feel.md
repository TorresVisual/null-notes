# Ink Pen Feel Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Strokes follow the pen with no perceptible lag however much is already on the page, real pen pressure drives stroke width, and the canvas can be drawn on with a mouse.

**Architecture:** Committed ink (strokes, shapes, texts) is painted once into an offscreen canvas keyed on `inkData` identity + backing scale + the text being edited; each pointer-move blits that layer and paints only the live stroke and overlays. All live previews go through one `scheduleRedraw` (≤ 1 `requestAnimationFrame` per frame), and freehand strokes get `getPredictedEvents()` points appended to a *copy* of the live buffer for that paint only. A single `strokeOptions(stroke)` builds every `getStroke` option object (kind derived from stored fields, `simulatePressure: false`) for both the canvas and the SVG serialiser. The three `pointerType === 'pen'` guards accept `'mouse'` (primary button) too.

**Tech Stack:** React 19 + TypeScript (strict), Canvas 2D, perfect-freehand, Vitest + Testing Library (jsdom).

**Spec:** `docs/specs/ink-pen-feel-design.md`

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

- No WebGL / new renderer, no pressure-curve editor, no change to the SVG sidecar format or the `Stroke` type (spec Non-Goals).
- Touch never draws: it still pans and pinch-zooms, palm rejection is unchanged. `InkCanvas`'s touch handling is untouched.
- Erase, lasso-move and text-drag stay O(strokes) per move; they mutate `inkData` and so invalidate the cache. Out of scope — file a follow-up, do not optimise.
- Predicted points are never pushed to `currentStroke` and never stored. Freehand only (not shapes or lasso); skipped when `getPredictedEvents` is missing.
- Mouse: primary button only, every tool, constant pressure `0.5`. Mouse wheel keeps scrolling the page.
- Kind is **derived from stored fields**, never stored: `opacity < 1` → highlighter, `thinning <= 0.2` → pencil, else ink.
- `simulatePressure: false`. Existing strokes re-render with the new options on load (accepted).
- The offscreen layer is a plain `<canvas>` element (`document.createElement('canvas')`); when `getContext('2d')` is `null` (jsdom) painting is a no-op exactly as today.
- `npm run lint` does not exist; verification is `npm run typecheck` and `npm test`.
- TypeScript strict: no `any`, no unexplained `!`. Named exports; no comments unless the WHY is non-obvious.
- Commit after each task, repo style `feat(ink): …`, no push, no amend.

## Review Focus

Failure modes the spec implies that happy-path tests would not catch, most likely first. Each has a test in the task named in brackets.

1. **Predicted points leaking into the saved stroke.** A stroke drawn with `getPredictedEvents` present must be stored with only the real points. [Task 4]
2. **Stale committed layer.** After a commit, and after undo, the next paint must show the current ink (a new `InkData` object must always miss the cache). [Task 2]
3. **Pointer-up racing a pending frame.** The pending `requestAnimationFrame` must be cancelled on release, not fire after the commit. [Task 3]
4. **Non-primary mouse buttons and touch must not draw; hover must not draw or erase.** [Task 5]
5. **Pen presets keep their kind.** Fine/Broad/Red/Blue → ink, Pencil → pencil, both highlighters → highlighter; a stroke with `thinning` undefined is ink. [Task 1]

---

## File Structure

| File | Change |
|---|---|
| `src/ink/strokeOptions.ts` | New — `DEFAULT_THINNING`, `strokeKind`, `strokeOptions` |
| `src/ink/strokeOptions.test.ts` | New |
| `src/ink/layerCache.ts` | New — `LayerKey`, `sameLayerKey` |
| `src/ink/layerCache.test.ts` | New |
| `src/ink/predict.ts` | New — `mergePredicted` |
| `src/ink/predict.test.ts` | New |
| `src/ink/useInkCanvas.ts` | Offscreen layer, `scheduleRedraw`/`flushRedraw`, predicted points, mouse guards, `strokeOptions` |
| `src/ink/InkCanvas.tsx` | Eraser ring for mouse as well as pen |
| `src/ink/svgSerialiser.ts` | `strokeOptions` instead of hardcoded 0.5 / 0.5 |
| `src/ink/inkPenFeel.test.tsx` | New — mounts `InkCanvas` with a recording fake 2D context; cache, batching, prediction and mouse/touch tests |

---

### Task 1: `strokeOptions` — one place for `getStroke` options

**Files:**
- Create: `src/ink/strokeOptions.ts`
- Create: `src/ink/strokeOptions.test.ts`
- Modify: `src/ink/useInkCanvas.ts:58-59,148-173`
- Modify: `src/ink/svgSerialiser.ts:1-36`

**Interfaces:**
- Produces:
  - `export const DEFAULT_THINNING = 0.5`
  - `export type StrokeKind = 'ink' | 'pencil' | 'highlighter'`
  - `export function strokeKind(stroke: Pick<Stroke, 'opacity' | 'thinning'>): StrokeKind`
  - `export function strokeOptions(stroke: Pick<Stroke, 'size' | 'opacity' | 'thinning'>): StrokeOptions` (perfect-freehand's type)

- [ ] **Step 1: Write the failing test**

`src/ink/strokeOptions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_PENS } from './pens'
import { DEFAULT_THINNING, strokeKind, strokeOptions } from './strokeOptions'

describe('strokeKind', () => {
  it('treats anything translucent as a highlighter, whatever its thinning', () => {
    expect(strokeKind({ opacity: 0.3, thinning: undefined })).toBe('highlighter')
    expect(strokeKind({ opacity: 0.99, thinning: 0.1 })).toBe('highlighter')
  })

  it('treats an opaque stroke with thinning <= 0.2 as a pencil', () => {
    expect(strokeKind({ opacity: 1, thinning: 0.1 })).toBe('pencil')
    expect(strokeKind({ opacity: 1, thinning: 0.2 })).toBe('pencil')
  })

  it('treats everything else as ink, including a stroke with no thinning stored', () => {
    expect(strokeKind({ opacity: 1, thinning: 0.21 })).toBe('ink')
    expect(strokeKind({ opacity: 1, thinning: undefined })).toBe('ink')
  })

  it('keeps every default pen preset in the kind it was designed as', () => {
    const kinds = Object.fromEntries(DEFAULT_PENS.map((p) => [p.id, strokeKind(p)]))
    expect(kinds).toEqual({
      fine: 'ink',
      broad: 'ink',
      red: 'ink',
      blue: 'ink',
      pencil: 'pencil',
      'highlight-yellow': 'highlighter',
      'highlight-green': 'highlighter',
    })
  })
})

describe('strokeOptions', () => {
  it('lets pen pressure drive the width', () => {
    for (const pen of DEFAULT_PENS) {
      expect(strokeOptions(pen).simulatePressure).toBe(false)
    }
  })

  it('passes size and thinning through, defaulting thinning', () => {
    expect(strokeOptions({ size: 5, opacity: 1, thinning: 0.1 })).toMatchObject({ size: 5, thinning: 0.1 })
    expect(strokeOptions({ size: 5, opacity: 1, thinning: undefined })).toMatchObject({
      size: 5,
      thinning: DEFAULT_THINNING,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ink/strokeOptions.test.ts`
Expected: FAIL — cannot resolve `./strokeOptions`.

- [ ] **Step 3: Write the module**

`src/ink/strokeOptions.ts`:

```ts
import type { StrokeOptions } from 'perfect-freehand'
import type { Stroke } from './types'

export const DEFAULT_THINNING = 0.5

export type StrokeKind = 'ink' | 'pencil' | 'highlighter'

// Derived, not stored: the sidecar format has no kind field and gaining one
// would mean a format change. These two fields are what the presets already
// differ in (`pens.ts`), so they are the kind.
export function strokeKind({ opacity, thinning }: Pick<Stroke, 'opacity' | 'thinning'>): StrokeKind {
  if (opacity < 1) return 'highlighter'
  if ((thinning ?? DEFAULT_THINNING) <= 0.2) return 'pencil'
  return 'ink'
}

// Starting values, tuned by eye in the running app and deliberately not
// unit-tested. Lower is crisper; the pencil follows the hand, the highlighter
// irons the wobble out of a wide wash.
const FEEL: Record<StrokeKind, { smoothing: number; streamline: number }> = {
  ink: { smoothing: 0.5, streamline: 0.5 },
  pencil: { smoothing: 0.3, streamline: 0.3 },
  highlighter: { smoothing: 0.7, streamline: 0.7 },
}

export function strokeOptions(stroke: Pick<Stroke, 'size' | 'opacity' | 'thinning'>): StrokeOptions {
  return {
    size: stroke.size,
    thinning: stroke.thinning ?? DEFAULT_THINNING,
    simulatePressure: false,
    ...FEEL[strokeKind(stroke)],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ink/strokeOptions.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the canvas and the serialiser**

`src/ink/useInkCanvas.ts` — add `import { strokeOptions } from './strokeOptions'` with the other local imports; delete the two constants (`DEFAULT_THINNING`, `STROKE_OPTIONS`, lines 58-59); change `fillStroke`:

```ts
function fillStroke(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  size: number,
  opacity: number,
  thinning?: number,
): void {
  const outline = getStroke(
    points.map((p) => [p.x, p.y, p.pressure]),
    strokeOptions({ size, opacity, thinning }),
  )
```
(the rest of `fillStroke` is unchanged).

`src/ink/svgSerialiser.ts` — add `import { DEFAULT_THINNING, strokeOptions } from './strokeOptions'` and replace the head of `strokeToPath`:

```ts
export function strokeToPath(stroke: Stroke): string {
  const thinning = stroke.thinning ?? DEFAULT_THINNING
  const inputPoints = stroke.points.map((p) => [p.x, p.y, p.pressure])
  const outlinePoints = getStroke(inputPoints, strokeOptions(stroke))
  const d = pointsToSvgPath(outlinePoints)
```
(the `raw` / `return` lines are unchanged — `data-thinning="${thinning}"` still writes the resolved value).

- [ ] **Step 6: Run the suite**

Run: `npm run typecheck && npx vitest run src/ink`
Expected: PASS. `svgSerialiser.test.ts` asserts `'M 10 10 L 100 80'` on a two-point stroke; if `simulatePressure: false` changes that first outline point, update the expected string to the actual output (it is a rendering detail, not a contract).

- [ ] **Step 7: Commit**

```bash
git add src/ink/strokeOptions.ts src/ink/strokeOptions.test.ts src/ink/useInkCanvas.ts src/ink/svgSerialiser.ts src/ink/svgSerialiser.test.ts
git commit -m "feat(ink): real pen pressure and per-kind smoothing via strokeOptions"
```

---

### Task 2: Committed-layer cache

**Files:**
- Create: `src/ink/layerCache.ts`
- Create: `src/ink/layerCache.test.ts`
- Create: `src/ink/inkPenFeel.test.tsx`
- Modify: `src/ink/useInkCanvas.ts` (`redrawCanvas`, ~line 432)

**Interfaces:**
- Produces:
  - `export interface LayerKey { inkData: InkData; scale: number; editingTextId: string | null }`
  - `export function sameLayerKey(cached: LayerKey | null, next: LayerKey): boolean`
  - In `inkPenFeel.test.tsx`: `installFakeContext(): { calls: Record<string, number>; restore: () => void }`, `mountCanvas(loaded?: InkData)`, `at(canvas, type, x, y, options?)`, `drawBent(canvas, kind?, predicted?)`, `lastWrite(): InkData` — reused by Tasks 3-5.

- [ ] **Step 1: Write the failing unit test**

`src/ink/layerCache.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sameLayerKey, type LayerKey } from './layerCache'
import type { InkData } from './types'

const data: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [], shapes: [], texts: [] }
const key: LayerKey = { inkData: data, scale: 2, editingTextId: null }

describe('sameLayerKey', () => {
  it('misses when nothing is cached yet', () => {
    expect(sameLayerKey(null, key)).toBe(false)
  })

  it('hits when every part matches', () => {
    expect(sameLayerKey(key, { ...key })).toBe(true)
  })

  it('misses on a new InkData object, even with identical contents', () => {
    expect(sameLayerKey(key, { ...key, inkData: { ...data } })).toBe(false)
  })

  it('misses when zoom or device pixel ratio changes the backing scale', () => {
    expect(sameLayerKey(key, { ...key, scale: 3 })).toBe(false)
  })

  it('misses when a different text item starts or stops being edited', () => {
    expect(sameLayerKey(key, { ...key, editingTextId: 't1' })).toBe(false)
    expect(sameLayerKey({ ...key, editingTextId: 't1' }, key)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ink/layerCache.test.ts`
Expected: FAIL — cannot resolve `./layerCache`.

- [ ] **Step 3: Write the module**

`src/ink/layerCache.ts`:

```ts
import type { InkData } from './types'

// Every edit allocates a new InkData (commit, undo, redo, erase, lasso move all
// go through setInkData), so object identity is a complete "did the committed
// ink change" test — no deep comparison, and no way to forget a mutation path.
export interface LayerKey {
  inkData: InkData
  scale: number
  editingTextId: string | null
}

export function sameLayerKey(cached: LayerKey | null, next: LayerKey): boolean {
  return (
    cached !== null &&
    cached.inkData === next.inkData &&
    cached.scale === next.scale &&
    cached.editingTextId === next.editingTextId
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/ink/layerCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing component test (shared harness + cache tests)**

`src/ink/inkPenFeel.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, createEvent, fireEvent, waitFor } from '@testing-library/react'
import { InkCanvas } from './InkCanvas'
import { useInkStore } from '../store/ink'
import { DEFAULT_PENS } from './pens'
import type { InkData, Stroke } from './types'

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
const PAGE: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [], shapes: [], texts: [] }

beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined)
  read.mockReset().mockResolvedValue(null)
  useInkStore.setState({
    tool: 'pen',
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

// jsdom has no 2D context, so painting is normally a silent no-op. A proxy that
// counts every method call lets a test observe how much painting happened
// without caring what was painted.
function installFakeContext() {
  const calls: Record<string, number> = {}
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined
      if (prop in target) return target[prop]
      return () => {
        calls[prop] = (calls[prop] ?? 0) + 1
      }
    },
    set: (target, prop, value) => {
      if (typeof prop === 'string') target[prop] = value
      return true
    },
  })
  const spy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation((() => ctx) as unknown as HTMLCanvasElement['getContext'])
  return { calls, restore: () => spy.mockRestore() }
}

type PointerKind = 'pen' | 'mouse' | 'touch'

interface PointerOptions {
  kind?: PointerKind
  button?: number
  predicted?: Array<[number, number]>
}

// jsdom computes no offsetX/offsetY, so page coordinates are set by hand.
function at(
  canvas: Element,
  type: 'pointerDown' | 'pointerMove' | 'pointerUp',
  x: number,
  y: number,
  { kind = 'pen', button, predicted }: PointerOptions = {},
) {
  const event = createEvent[type](canvas, { pointerType: kind, pointerId: 1, ...(button === undefined ? {} : { button }) })
  Object.defineProperty(event, 'offsetX', { value: x })
  Object.defineProperty(event, 'offsetY', { value: y })
  if (predicted) {
    const events = predicted.map(([px, py]) => ({ offsetX: px, offsetY: py, pressure: 0.5, pointerType: kind }))
    Object.defineProperty(event, 'getPredictedEvents', { value: () => events })
  }
  fireEvent(canvas, event)
}

// A V shape: far enough from straight that auto-straighten leaves it a stroke.
function drawBent(canvas: Element, options: PointerOptions = {}) {
  at(canvas, 'pointerDown', 10, 10, options)
  at(canvas, 'pointerMove', 60, 80, options)
  at(canvas, 'pointerMove', 110, 10, options)
  at(canvas, 'pointerUp', 110, 10, options)
}

async function mountCanvas(loaded: InkData = PAGE) {
  read.mockResolvedValue(loaded)
  const view = render(<InkCanvas svgPath={SRC} width={800} height={600} />)
  await waitFor(() => expect(read).toHaveBeenCalled())
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { ...view, canvas: view.container.querySelector('canvas')! }
}

function lastWrite(): InkData {
  const call = write.mock.calls[write.mock.calls.length - 1]
  if (!call) throw new Error('nothing written')
  return call[1]
}

function existingStrokes(count: number): Stroke[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    color: '#ffffff',
    size: 2,
    opacity: 1,
    points: [
      { x: 10, y: 100 + i * 20, pressure: 0.5 },
      { x: 100, y: 130 + i * 20, pressure: 0.5 },
      { x: 200, y: 100 + i * 20, pressure: 0.5 },
    ],
  }))
}

describe('committed layer cache', () => {
  it('paints only the live stroke on pointer-move, not the ink already on the page', async () => {
    const fake = installFakeContext()
    try {
      const { canvas } = await mountCanvas({ ...PAGE, strokes: existingStrokes(5) })
      fake.calls.fill = 0

      at(canvas, 'pointerDown', 10, 400)
      at(canvas, 'pointerMove', 60, 420)
      await waitFor(() => expect(fake.calls.fill).toBeGreaterThan(0))

      expect(fake.calls.fill).toBe(1)
    } finally {
      fake.restore()
    }
  })

  // Review Focus 2: a cache that outlives an edit leaves the new stroke
  // invisible until the file is reopened.
  it('repaints the committed ink after a commit and again after undo', async () => {
    const fake = installFakeContext()
    try {
      const { canvas } = await mountCanvas({ ...PAGE, strokes: existingStrokes(5) })

      at(canvas, 'pointerDown', 10, 400)
      at(canvas, 'pointerMove', 60, 480)
      at(canvas, 'pointerMove', 110, 400)
      await waitFor(() => expect(fake.calls.fill).toBeGreaterThan(0))

      fake.calls.fill = 0
      at(canvas, 'pointerUp', 110, 400)
      await waitFor(() => expect(fake.calls.fill).toBe(6))

      fake.calls.fill = 0
      useInkStore.getState().activeCanvas?.undo()
      await waitFor(() => expect(fake.calls.fill).toBe(5))
    } finally {
      fake.restore()
    }
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/ink/inkPenFeel.test.tsx`
Expected: FAIL — the first test sees `fill` = 6 (every committed stroke repainted per move); the second may also fail on counts.

- [ ] **Step 7: Implement the offscreen layer**

`src/ink/useInkCanvas.ts` — add `import { sameLayerKey } from './layerCache'` and `import type { LayerKey } from './layerCache'` (one line: `import { sameLayerKey, type LayerKey } from './layerCache'`).

Add a module-level helper next to `fillStroke`:

```ts
function paintCommitted(ctx: CanvasRenderingContext2D, data: InkData, editingTextId: string | null): void {
  for (const stroke of paintOrder(data.strokes)) {
    fillStroke(ctx, stroke.points, stroke.color, stroke.size, stroke.opacity, stroke.thinning)
  }
  for (const shape of data.shapes) {
    drawShapePreview(ctx, shape)
  }
  // The item being typed renders through the overlay textarea instead —
  // drawing it here too would show it twice, once live and once stale.
  for (const item of data.texts) {
    if (editingTextId === item.id) continue
    drawTextItem(ctx, item)
  }
}
```

Add the ref next to the other refs (after `currentStroke`):

```ts
const committed = useRef<{ canvas: HTMLCanvasElement; key: LayerKey } | null>(null)
```

Replace the body of `redrawCanvas` from `ctx.setTransform(scale, …` through the end of the text loop (the `for (const item of inkData.texts)` block) with:

```ts
      const key: LayerKey = { inkData, scale, editingTextId: editingText?.id ?? null }
      const cached = committed.current
      const layerCanvas = cached?.canvas ?? document.createElement('canvas')
      if (!sameLayerKey(cached?.key ?? null, key)) {
        const layerCtx = layerCanvas.getContext('2d')
        if (!layerCtx) return
        layerCanvas.width = pixelWidth
        layerCanvas.height = pixelHeight
        layerCtx.setTransform(scale, 0, 0, scale, -inkData.originX * scale, -inkData.originY * scale)
        paintCommitted(layerCtx, inkData, key.editingTextId)
        committed.current = { canvas: layerCanvas, key }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, pixelWidth, pixelHeight)
      ctx.drawImage(layerCanvas, 0, 0)
      ctx.setTransform(scale, 0, 0, scale, -inkData.originX * scale, -inkData.originY * scale)
```

The live-stroke / live-shape / lasso / ruler section below it is unchanged. Assigning `layerCanvas.width` always clears the bitmap, which is the intended rebuild.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run typecheck && npx vitest run src/ink`
Expected: PASS. If `waitFor(... toBe(6))` is flaky because React re-renders trigger extra rebuilds, the cause is a cache miss that should not happen — find it rather than loosening the assertion.

- [ ] **Step 9: Commit**

```bash
git add src/ink/layerCache.ts src/ink/layerCache.test.ts src/ink/inkPenFeel.test.tsx src/ink/useInkCanvas.ts
git commit -m "feat(ink): cache committed ink in an offscreen layer"
```

---

### Task 3: Frame-batched live repaints

**Files:**
- Modify: `src/ink/useInkCanvas.ts` (after `redrawCanvas`; `handlePointerMove`; `handlePointerUp`)
- Test: `src/ink/inkPenFeel.test.tsx`

**Interfaces:**
- Consumes: `redrawCanvas(livePoints, liveShape?, liveLasso?)` from Task 2's file.
- Produces (hook-internal): `scheduleRedraw(...live: Parameters<typeof redrawCanvas>): void`, `flushRedraw(): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ink/inkPenFeel.test.tsx`:

```tsx
describe('frame batching', () => {
  it('paints one frame for several pointer-moves in the same tick', async () => {
    const fake = installFakeContext()
    try {
      const { canvas } = await mountCanvas()
      fake.calls.fill = 0

      at(canvas, 'pointerDown', 10, 400)
      at(canvas, 'pointerMove', 40, 410)
      at(canvas, 'pointerMove', 70, 420)
      at(canvas, 'pointerMove', 100, 430)
      await waitFor(() => expect(fake.calls.fill).toBeGreaterThan(0))

      expect(fake.calls.fill).toBe(1)
    } finally {
      fake.restore()
    }
  })

  // Review Focus 3: a frame that fires after the commit would paint the stale
  // live stroke over the final ink.
  it('cancels the pending frame on release', async () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    try {
      const { canvas } = await mountCanvas()
      drawBent(canvas)
      expect(cancel).toHaveBeenCalled()
    } finally {
      cancel.mockRestore()
    }
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ink/inkPenFeel.test.tsx -t "frame batching"`
Expected: FAIL — `fill` is 3 (one paint per move) and `cancelAnimationFrame` is never called.

- [ ] **Step 3: Implement**

`src/ink/useInkCanvas.ts` — directly after the `useEffect(() => { redrawCanvas([]) }, …)` block add:

```ts
  // Pen digitisers report faster than displays refresh, so painting per event
  // paints frames nobody sees. The latest preview wins; at most one frame is
  // ever queued.
  const frame = useRef<number | null>(null)
  const pendingLive = useRef<Parameters<typeof redrawCanvas>>([[]])
  const redrawRef = useRef(redrawCanvas)
  useEffect(() => {
    redrawRef.current = redrawCanvas
  }, [redrawCanvas])

  const scheduleRedraw = useCallback((...live: Parameters<typeof redrawCanvas>) => {
    pendingLive.current = live
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      redrawRef.current(...pendingLive.current)
    })
  }, [])

  const flushRedraw = useCallback(() => {
    if (frame.current === null) return
    cancelAnimationFrame(frame.current)
    frame.current = null
    redrawRef.current(...pendingLive.current)
  }, [])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )
```

In `handlePointerMove`, replace the three `redrawCanvas(` calls with `scheduleRedraw(` (lasso path, shape preview, freehand), and in its dependency array replace `redrawCanvas` with `scheduleRedraw`.

In `handlePointerUp`, right after `releasePointer(canvasRef.current, e.pointerId)` add `flushRedraw()`, and add `flushRedraw` to the dependency array.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck && npx vitest run src/ink`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ink/useInkCanvas.ts src/ink/inkPenFeel.test.tsx
git commit -m "feat(ink): batch live previews into one repaint per frame"
```

---

### Task 4: Predicted points

**Files:**
- Create: `src/ink/predict.ts`
- Create: `src/ink/predict.test.ts`
- Modify: `src/ink/useInkCanvas.ts` (`handlePointerDown`, `handlePointerMove`)
- Test: `src/ink/inkPenFeel.test.tsx`

**Interfaces:**
- Produces: `export function mergePredicted(live: Point[], predicted: Point[]): Point[]`
- Hook-internal: `pressureOf(e: { pointerType: string; pressure: number }): number` and a `toPoint(ev: PointerEvent): Point` closure (both reused by Task 5).

- [ ] **Step 1: Write the failing unit test**

`src/ink/predict.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mergePredicted } from './predict'
import type { Point } from './types'

const p = (x: number): Point => ({ x, y: 0, pressure: 0.5 })

describe('mergePredicted', () => {
  it('appends predicted points after the real ones, in order', () => {
    expect(mergePredicted([p(1), p(2)], [p(3), p(4)])).toEqual([p(1), p(2), p(3), p(4)])
  })

  it('returns the live buffer untouched when nothing is predicted', () => {
    const live = [p(1)]
    expect(mergePredicted(live, [])).toBe(live)
  })

  // The live buffer becomes the saved stroke; a prediction in it is ink the
  // pen never drew.
  it('never mutates the live buffer', () => {
    const live = [p(1), p(2)]
    mergePredicted(live, [p(3)])
    expect(live).toEqual([p(1), p(2)])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ink/predict.test.ts`
Expected: FAIL — cannot resolve `./predict`.

- [ ] **Step 3: Write the module**

`src/ink/predict.ts`:

```ts
import type { Point } from './types'

// The result is for one frame's paint only. Returning a copy is the whole
// contract: the live buffer is what gets committed, and a predicted point that
// reached it would be saved as ink the pen never drew.
export function mergePredicted(live: Point[], predicted: Point[]): Point[] {
  return predicted.length === 0 ? live : [...live, ...predicted]
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/ink/predict.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing component test**

Append to `src/ink/inkPenFeel.test.tsx`:

```tsx
describe('prediction', () => {
  // Review Focus 1.
  it('saves only the points the pen actually reported', async () => {
    const { canvas } = await mountCanvas()
    const predicted: Array<[number, number]> = [[777, 777], [888, 888]]
    drawBent(canvas, { predicted })

    const stroke = lastWrite().strokes[0]
    expect(stroke?.points).toHaveLength(3)
    expect(stroke?.points.some((pt) => pt.x === 777 || pt.x === 888)).toBe(false)
  })

  it('still draws when the browser has no getPredictedEvents', async () => {
    const { canvas } = await mountCanvas()
    drawBent(canvas)
    expect(lastWrite().strokes).toHaveLength(1)
  })
})
```

- [ ] **Step 6: Run to see the baseline**

Run: `npx vitest run src/ink/inkPenFeel.test.tsx -t "prediction"`
Expected: PASS already (prediction is not implemented yet, so nothing leaks). These tests pin the invariant before the feature exists; they must stay green after Step 7.

- [ ] **Step 7: Implement**

`src/ink/useInkCanvas.ts` — add `import { mergePredicted } from './predict'`.

Module level, near `toInk`:

```ts
const MOUSE_PRESSURE = 0.5

function pressureOf(e: { pointerType: string; pressure: number }): number {
  return e.pointerType === 'mouse' ? MOUSE_PRESSURE : e.pressure
}
```

In `handlePointerDown`, change the stroke start to use it:

```ts
      const start = { x: at.x, y: at.y, pressure: pressureOf(e) }
```

In `handlePointerMove`, replace the final freehand block (from `const events = e.getCoalescedEvents?.() ?? [e]` to the `scheduleRedraw(...)`) with:

```ts
      const toPoint = (ev: PointerEvent): Point => ({ ...toInk(ev, zoom, origin), pressure: pressureOf(ev) })
      const events = e.getCoalescedEvents?.() ?? [e]
      for (const ce of events) {
        currentStroke.current.push(toPoint(ce))
      }
      const predicted = (e.getPredictedEvents?.() ?? []).map(toPoint)
      scheduleRedraw(snappedPoints(mergePredicted(currentStroke.current, predicted)))
```

- [ ] **Step 8: Run to verify everything passes**

Run: `npm run typecheck && npx vitest run src/ink`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/ink/predict.ts src/ink/predict.test.ts src/ink/useInkCanvas.ts src/ink/inkPenFeel.test.tsx
git commit -m "feat(ink): paint predicted points ahead of the pen, never store them"
```

---

### Task 5: Mouse drawing

**Files:**
- Modify: `src/ink/useInkCanvas.ts` (`handlePointerDown`, `handlePointerMove`, `handlePointerUp`)
- Modify: `src/ink/InkCanvas.tsx:199`
- Test: `src/ink/inkPenFeel.test.tsx`

**Interfaces:**
- Consumes: `pressureOf` from Task 4.
- Produces: `export function isDrawingPointer(e: { pointerType: string }): boolean` in `useInkCanvas.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ink/inkPenFeel.test.tsx`:

```tsx
describe('mouse drawing', () => {
  it('commits a stroke from a mouse sequence, at constant pressure', async () => {
    const { canvas } = await mountCanvas()
    drawBent(canvas, { kind: 'mouse' })

    const stroke = lastWrite().strokes[0]
    expect(stroke?.points).toHaveLength(3)
    expect(stroke?.points.every((pt) => pt.pressure === 0.5)).toBe(true)
  })

  // Review Focus 4.
  it('ignores a touch sequence', async () => {
    const { canvas } = await mountCanvas()
    drawBent(canvas, { kind: 'touch' })
    expect(write).not.toHaveBeenCalled()
  })

  it('ignores the right and middle mouse buttons', async () => {
    const { canvas } = await mountCanvas()
    drawBent(canvas, { kind: 'mouse', button: 2 })
    drawBent(canvas, { kind: 'mouse', button: 1 })
    expect(write).not.toHaveBeenCalled()
  })

  it('does not draw while the mouse only hovers', async () => {
    const { canvas } = await mountCanvas()
    at(canvas, 'pointerMove', 60, 80, { kind: 'mouse' })
    at(canvas, 'pointerMove', 110, 10, { kind: 'mouse' })
    at(canvas, 'pointerUp', 110, 10, { kind: 'mouse' })
    expect(write).not.toHaveBeenCalled()
  })

  it('auto-straightens a near-straight mouse stroke like a pen stroke', async () => {
    const { canvas } = await mountCanvas()
    at(canvas, 'pointerDown', 10, 10, { kind: 'mouse' })
    at(canvas, 'pointerMove', 200, 11, { kind: 'mouse' })
    at(canvas, 'pointerMove', 400, 10, { kind: 'mouse' })
    at(canvas, 'pointerUp', 400, 10, { kind: 'mouse' })

    const saved = lastWrite()
    expect(saved.strokes).toHaveLength(0)
    expect(saved.shapes[0]).toMatchObject({ kind: 'line' })
  })

  it('shows the eraser ring for a mouse when the eraser is selected', async () => {
    useInkStore.setState({ tool: 'eraser' })
    const { canvas, container } = await mountCanvas()
    at(canvas, 'pointerMove', 50, 50, { kind: 'mouse' })
    expect(container.querySelector('.ink-eraser-cursor')).not.toBeNull()
  })

  it('erases with the mouse', async () => {
    useInkStore.setState({ tool: 'eraser', eraserMode: 'stroke' })
    const { canvas } = await mountCanvas({ ...PAGE, strokes: existingStrokes(1) })
    at(canvas, 'pointerDown', 10, 100, { kind: 'mouse' })
    at(canvas, 'pointerUp', 10, 100, { kind: 'mouse' })
    expect(lastWrite().strokes).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ink/inkPenFeel.test.tsx -t "mouse drawing"`
Expected: FAIL — mouse sequences write nothing; the eraser ring is absent.

- [ ] **Step 3: Implement**

`src/ink/useInkCanvas.ts` — next to `isEraserTip` add:

```ts
// Touch pans and pinches, so it never draws; pen and mouse do.
export function isDrawingPointer(e: { pointerType: string }): boolean {
  return e.pointerType === 'pen' || e.pointerType === 'mouse'
}
```

Replace the three guards:

- `handlePointerDown`: `if (!isDrawingPointer(e) || (e.pointerType === 'mouse' && e.button !== 0)) return`
- `handlePointerMove`: `if (!isDrawingPointer(e)) return`
- `handlePointerUp`: `if (!isDrawingPointer(e)) return`

`src/ink/InkCanvas.tsx` — import `isDrawingPointer` alongside `isEraserTip` and change the erasing condition (line 199) to:

```ts
    const erasing = isDrawingPointer(e) && (tool === 'eraser' || isEraserTip(e))
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck && npx vitest run src/ink`
Expected: PASS. If the eraser test fails because `eraseSnapshot` needs the stroke under `(10, 100)`, check `pointEraser`'s hit radius against `eraserSize: 12` and adjust the test point onto the stroke, not the production code.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS across the repo (inline ink blocks, PDF overlays and the full-screen editor all mount `InkCanvas`).

- [ ] **Step 6: Commit**

```bash
git add src/ink/useInkCanvas.ts src/ink/InkCanvas.tsx src/ink/inkPenFeel.test.tsx
git commit -m "feat(ink): draw, erase and straighten with the mouse"
```

---

### Task 6: Manual QA in the running app

**Files:** none (tuning edits, if any, land in `src/ink/strokeOptions.ts`).

- [ ] **Step 1: Build a ~500-stroke note**

Run `npm run tauri dev`, open the full-screen ink editor on a scratch note, and fill it with about 500 strokes (hold the pen down and scribble; many short strokes are fine).

- [ ] **Step 2: Profile pointer-move → paint**

In the WebView devtools Performance tab, record a continuous stroke on the full page. Expected: scripting per frame is flat (live stroke + one blit), not growing with stroke count. Record the one-time rebuild at stroke end; if it visibly hitches at 500 strokes, note it as a follow-up (incremental append is not possible because `paintOrder` can put a highlighter under existing ink) — do not optimise here.

- [ ] **Step 3: Eyeball each pen kind**

Draw with Fine, Pencil and a highlighter. Expected: the pencil follows the hand more tightly than ink; the highlighter is smoother than ink; pen pressure visibly varies the width of ink strokes. Adjust the `FEEL` table in `strokeOptions.ts` by eye if any kind feels wrong.

- [ ] **Step 4: Compare width on an existing note**

Open a note drawn before this change next to a build from `main`. If strokes now look visibly thinner (pressure 0.5 renders at 0.5 × `size`), add **one** global width factor inside `strokeOptions()` (multiply `size` there); do not edit pen presets.

- [ ] **Step 5: Mouse and touch**

Expected: the mouse draws, erases (with the eraser ring), lasso-selects, places text and straightens a near-straight stroke, in the full-screen editor, an inline ink block and a PDF-page overlay; right/middle click leaves nothing; the wheel still scrolls; a touch still pans and pinch-zooms and never draws. In an inline ink block, confirm dragging the mouse does not also select the surrounding note text or the node; if it does, call `e.preventDefault()` on mouse `pointerdown` in `handlePointerDown` and re-check that the text tool still focuses its textarea.

- [ ] **Step 6: Final gate and commit any tuning**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/ink/strokeOptions.ts
git commit -m "feat(ink): tune pen feel after QA"
```
(Skip the commit if QA required no changes.)

---

## Self-Review

- **Spec coverage:** design 1 → Task 2; 2 → Task 4; 3 → Task 3; 4 → Task 5; 5 → Task 1; File Structure rows all covered; Testing section → unit tests in Tasks 1/2/4, hook-level mouse-vs-touch test in Task 5, manual QA in Task 6. Non-Goals respected (no format/type change, erase/lasso/text-drag unchanged).
- **Placeholders:** none; every code step shows code. Smoothing values are explicit starting numbers, tuning is Task 6.
- **Type consistency:** `strokeOptions`/`strokeKind`/`DEFAULT_THINNING` (Task 1), `LayerKey`/`sameLayerKey` (Task 2), `scheduleRedraw`/`flushRedraw` (Task 3), `mergePredicted`/`pressureOf`/`toPoint` (Task 4), `isDrawingPointer` (Task 5) are used with the same names and signatures throughout; the test harness (`installFakeContext`, `at`, `drawBent`, `mountCanvas`, `lastWrite`, `existingStrokes`) is defined once in Task 2 and reused.
- **Review Focus:** all five lines have a test in the named task.
