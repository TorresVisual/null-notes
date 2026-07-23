# Ink Toolbar & Canvas Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Fix five functional bugs in the ink drawing pipeline (arrow renders as an ellipse, shapes can't be erased, wrong live shape preview, a stray-buffer leak, and a missing initial canvas paint) and add an eraser cursor ring, per `docs/specs/ink-toolbar-polish-design.md`.

**Architecture:** Two new pure, fully-unit-tested modules (`hitTest.ts` for shape hit-testing, `shapePreview.ts` for canvas-side shape rendering) that `useInkCanvas.ts` wires together; a small serialization fix in `svgSerialiser.ts`; a local-state cursor overlay in `InkCanvas.tsx`.

**Tech Stack:** React 19 + TypeScript (strict), Canvas 2D API, `perfect-freehand`, Vitest.

## Global Constraints

- No new tool types, no canvas resizing, no stroke-size preview UI, no color presets (spec Non-Goals).
- No segment-level erase — still v2 (spec Non-Goals, `docs/specs/tech-stack-design.md`).
- Pointer-event wiring inside `useInkCanvas.ts` is not unit-tested with simulated `PointerEvent`s, matching existing precedent in this codebase (its pointer-driven logic already has zero such coverage) — verified via manual QA instead (spec Testing section).
- `npm run lint` does not exist in this repo (no script, no ESLint config) — use `npm run typecheck` only.

---

## File Structure

| File | Change |
|---|---|
| `src/ink/hitTest.ts` | Create — pure hit-testing functions |
| `src/ink/hitTest.test.ts` | Create — unit tests |
| `src/ink/shapePreview.ts` | Create — pure canvas-drawing function for shape rendering |
| `src/ink/shapePreview.test.ts` | Create — unit tests against a mock canvas context |
| `src/ink/svgSerialiser.ts` | Modify — arrow case in `shapeToElement`; parsing fix in `svgToInkData` |
| `src/ink/svgSerialiser.test.ts` | Modify — arrow serialization + cross-contamination regression tests |
| `src/ink/useInkCanvas.ts` | Modify — eraser filters shapes; shape-drag preview; buffer-leak fix; initial-paint fix |
| `src/ink/InkCanvas.tsx` | Modify — eraser cursor overlay |
| `src/index.css` | Modify — new `.ink-eraser-cursor` rule |

No files are deleted.

---

### Task 1: Shape hit-testing — `src/ink/hitTest.ts`

**Files:**
- Create: `src/ink/hitTest.ts`
- Test: `src/ink/hitTest.test.ts`

**Interfaces:**
- Consumes: `Shape` type from `src/ink/types.ts` (`{ id, kind: 'line'|'circle'|'rect'|'arrow', x1, y1, x2, y2, color, size }`).
- Produces: `pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number` and `hitTestShape(shape: Shape, x: number, y: number, radius: number): boolean`, both consumed by Task 6 (`useInkCanvas.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/ink/hitTest.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pointToSegmentDistance, hitTestShape } from './hitTest'
import type { Shape } from './types'

describe('pointToSegmentDistance', () => {
  it('returns 0 for a point on the segment', () => {
    expect(pointToSegmentDistance(5, 0, 0, 0, 10, 0)).toBe(0)
  })

  it('returns perpendicular distance for a point off the segment', () => {
    expect(pointToSegmentDistance(5, 5, 0, 0, 10, 0)).toBe(5)
  })

  it('clamps to the nearest endpoint beyond the segment', () => {
    expect(pointToSegmentDistance(20, 0, 0, 0, 10, 0)).toBe(10)
  })

  it('falls back to point distance for a zero-length segment', () => {
    expect(pointToSegmentDistance(3, 4, 0, 0, 0, 0)).toBe(5)
  })
})

describe('hitTestShape', () => {
  const line: Shape = { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, color: '#000', size: 2 }
  const rect: Shape = { id: 'r1', kind: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', size: 2 }
  const circle: Shape = { id: 'c1', kind: 'circle', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', size: 2 }
  const arrow: Shape = { id: 'a1', kind: 'arrow', x1: 0, y1: 0, x2: 10, y2: 0, color: '#000', size: 2 }

  it('hits a line within radius', () => {
    expect(hitTestShape(line, 5, 1, 2)).toBe(true)
  })

  it('misses a line beyond radius', () => {
    expect(hitTestShape(line, 5, 10, 2)).toBe(false)
  })

  it('hits an arrow the same as a line', () => {
    expect(hitTestShape(arrow, 5, 1, 2)).toBe(true)
  })

  it('hits a rect near its edge', () => {
    expect(hitTestShape(rect, 5, 0, 1)).toBe(true)
  })

  it('misses a rect interior far from any edge', () => {
    expect(hitTestShape(rect, 5, 5, 1)).toBe(false)
  })

  it('hits a circle near its ring', () => {
    expect(hitTestShape(circle, 5, 0, 1)).toBe(true)
  })

  it('misses a circle at its center', () => {
    expect(hitTestShape(circle, 5, 5, 1)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/ink/hitTest.test.ts`
Expected: FAIL — `Failed to resolve import "./hitTest"`.

- [ ] **Step 3: Write the implementation**

Create `src/ink/hitTest.ts`:

```ts
import type { Shape } from './types'

export function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))
  const closestX = x1 + t * dx
  const closestY = y1 + t * dy
  return Math.hypot(px - closestX, py - closestY)
}

export function hitTestShape(shape: Shape, x: number, y: number, radius: number): boolean {
  switch (shape.kind) {
    case 'line':
    case 'arrow':
      return pointToSegmentDistance(x, y, shape.x1, shape.y1, shape.x2, shape.y2) <= radius
    case 'rect': {
      const left = Math.min(shape.x1, shape.x2)
      const right = Math.max(shape.x1, shape.x2)
      const top = Math.min(shape.y1, shape.y2)
      const bottom = Math.max(shape.y1, shape.y2)
      const edges: [number, number, number, number][] = [
        [left, top, right, top],
        [right, top, right, bottom],
        [right, bottom, left, bottom],
        [left, bottom, left, top],
      ]
      return edges.some(([ex1, ey1, ex2, ey2]) => pointToSegmentDistance(x, y, ex1, ey1, ex2, ey2) <= radius)
    }
    case 'circle': {
      const cx = (shape.x1 + shape.x2) / 2
      const cy = (shape.y1 + shape.y2) / 2
      const rx = Math.abs(shape.x2 - shape.x1) / 2
      const ry = Math.abs(shape.y2 - shape.y1) / 2
      if (rx === 0 || ry === 0) return Math.hypot(x - cx, y - cy) <= radius
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      const normalizedDist = Math.hypot(dx, dy)
      return Math.abs(normalizedDist - 1) * Math.min(rx, ry) <= radius
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/ink/hitTest.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/ink/hitTest.ts src/ink/hitTest.test.ts
git commit -m "feat: pure shape hit-testing for the ink eraser"
```

---

### Task 2: Shape canvas preview — `src/ink/shapePreview.ts`

**Files:**
- Create: `src/ink/shapePreview.ts`
- Test: `src/ink/shapePreview.test.ts`

**Interfaces:**
- Produces: `PreviewShape` type (`{ kind: 'line'|'circle'|'rect'|'arrow', x1, y1, x2, y2, color: string, size: number }`) and `drawShapePreview(ctx: CanvasRenderingContext2D, shape: PreviewShape): void`, both consumed by Task 6 (`useInkCanvas.ts`). A `Shape` (from `src/ink/types.ts`) is assignable to `PreviewShape` — it's a superset with an extra `id` field.

- [ ] **Step 1: Write the failing tests**

Create `src/ink/shapePreview.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { drawShapePreview } from './shapePreview'

function createMockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    rect: vi.fn(),
    ellipse: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D
}

describe('drawShapePreview', () => {
  it('draws a line with moveTo/lineTo and strokes it', () => {
    const ctx = createMockCtx()
    drawShapePreview(ctx, { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', size: 2 })
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0)
    expect(ctx.lineTo).toHaveBeenCalledWith(10, 10)
    expect(ctx.stroke).toHaveBeenCalled()
  })

  it('draws a rect via ctx.rect with normalized bounds', () => {
    const ctx = createMockCtx()
    drawShapePreview(ctx, { kind: 'rect', x1: 10, y1: 10, x2: 0, y2: 0, color: '#000', size: 2 })
    expect(ctx.rect).toHaveBeenCalledWith(0, 0, 10, 10)
  })

  it('draws a circle via ctx.ellipse', () => {
    const ctx = createMockCtx()
    drawShapePreview(ctx, { kind: 'circle', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', size: 2 })
    expect(ctx.ellipse).toHaveBeenCalledWith(5, 5, 5, 5, 0, 0, Math.PI * 2)
  })

  it('draws an arrow as a line plus two head segments', () => {
    const ctx = createMockCtx()
    drawShapePreview(ctx, { kind: 'arrow', x1: 0, y1: 0, x2: 10, y2: 0, color: '#000', size: 2 })
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0)
    expect(ctx.lineTo).toHaveBeenCalledWith(10, 0)
    expect(ctx.moveTo).toHaveBeenCalledTimes(3)
    expect(ctx.lineTo).toHaveBeenCalledTimes(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/ink/shapePreview.test.ts`
Expected: FAIL — `Failed to resolve import "./shapePreview"`.

- [ ] **Step 3: Write the implementation**

Create `src/ink/shapePreview.ts`:

```ts
export interface PreviewShape {
  kind: 'line' | 'circle' | 'rect' | 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  size: number
}

export function drawShapePreview(ctx: CanvasRenderingContext2D, shape: PreviewShape): void {
  ctx.save()
  ctx.strokeStyle = shape.color
  ctx.lineWidth = shape.size
  ctx.beginPath()

  switch (shape.kind) {
    case 'line':
      ctx.moveTo(shape.x1, shape.y1)
      ctx.lineTo(shape.x2, shape.y2)
      break
    case 'rect': {
      const x = Math.min(shape.x1, shape.x2)
      const y = Math.min(shape.y1, shape.y2)
      const w = Math.abs(shape.x2 - shape.x1)
      const h = Math.abs(shape.y2 - shape.y1)
      ctx.rect(x, y, w, h)
      break
    }
    case 'circle': {
      const cx = (shape.x1 + shape.x2) / 2
      const cy = (shape.y1 + shape.y2) / 2
      const rx = Math.abs(shape.x2 - shape.x1) / 2
      const ry = Math.abs(shape.y2 - shape.y1) / 2
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      break
    }
    case 'arrow': {
      const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1)
      const dist = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1)
      const headLength = Math.min(18, dist * 0.4)
      const headAngle = 0.436
      ctx.moveTo(shape.x1, shape.y1)
      ctx.lineTo(shape.x2, shape.y2)
      ctx.moveTo(shape.x2, shape.y2)
      ctx.lineTo(
        shape.x2 - headLength * Math.cos(angle - headAngle),
        shape.y2 - headLength * Math.sin(angle - headAngle),
      )
      ctx.moveTo(shape.x2, shape.y2)
      ctx.lineTo(
        shape.x2 - headLength * Math.cos(angle + headAngle),
        shape.y2 - headLength * Math.sin(angle + headAngle),
      )
      break
    }
  }

  ctx.stroke()
  ctx.restore()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/ink/shapePreview.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/ink/shapePreview.ts src/ink/shapePreview.test.ts
git commit -m "feat: pure canvas shape-preview renderer"
```

---

### Task 3: Arrow serialization — `src/ink/svgSerialiser.ts`

**Files:**
- Modify: `src/ink/svgSerialiser.ts`
- Modify: `src/ink/svgSerialiser.test.ts`

**Interfaces:**
- Consumes: `Shape` type from `src/ink/types.ts`.
- Produces: `shapeToElement` now returns a `<path data-kind="arrow">` for arrow shapes (previously fell through to the ellipse branch); `svgToInkData` now correctly separates stroke `<path>`s from the arrow `<path>` via the `data-kind` attribute. No signature changes — both functions keep their existing exported names and types, so nothing downstream needs updating for this task alone.

- [ ] **Step 1: Write the failing tests**

In `src/ink/svgSerialiser.test.ts`, add inside the existing `describe('shapeToElement', ...)` block (after the existing 3 `it` blocks, before its closing `})`):

```ts
  it('returns a path element with an arrowhead for arrow kind', () => {
    const arrow: Shape = { ...shape, id: 'sh4', kind: 'arrow' }
    const result = shapeToElement(arrow)
    expect(result).toContain('<path')
    expect(result).toContain('data-kind="arrow"')
    expect(result).toContain('M 10 10 L 100 80')
  })
```

Then add a new test inside the existing `describe('inkDataToSvg / svgToInkData roundtrip', ...)` block (after the existing `it`, before its closing `})`):

```ts
  it('round-trips a stroke alongside an arrow without cross-contamination', () => {
    const arrow: Shape = { ...shape, id: 'sh4', kind: 'arrow' }
    const data: InkData = { width: 800, height: 600, strokes: [stroke], shapes: [arrow] }
    const svg = inkDataToSvg(data)

    const restored = svgToInkData(svg)
    expect(restored.strokes).toHaveLength(1)
    expect(restored.strokes[0]?.id).toBe('s1')
    expect(restored.shapes).toHaveLength(1)
    expect(restored.shapes[0]?.id).toBe('sh4')
    expect(restored.shapes[0]?.kind).toBe('arrow')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/ink/svgSerialiser.test.ts`
Expected: FAIL — the arrow test fails because `shapeToElement` currently returns an `<ellipse>` for `arrow` kind (no `<path>`, no `data-kind="arrow"`); the round-trip test fails because the arrow (stored as an `<ellipse>`) doesn't survive as `kind: 'arrow'`.

- [ ] **Step 3: Fix `shapeToElement`**

In `src/ink/svgSerialiser.ts`, replace:

```ts
    case 'circle':
    case 'arrow': {
      const cx = (shape.x1 + shape.x2) / 2
      const cy = (shape.y1 + shape.y2) / 2
      const rx = Math.abs(shape.x2 - shape.x1) / 2
      const ry = Math.abs(shape.y2 - shape.y1) / 2
      return `<ellipse ${base} cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" />`
    }
  }
}
```

with:

```ts
    case 'circle': {
      const cx = (shape.x1 + shape.x2) / 2
      const cy = (shape.y1 + shape.y2) / 2
      const rx = Math.abs(shape.x2 - shape.x1) / 2
      const ry = Math.abs(shape.y2 - shape.y1) / 2
      return `<ellipse ${base} cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" />`
    }
    case 'arrow': {
      const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1)
      const dist = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1)
      const headLength = Math.min(18, dist * 0.4)
      const headAngle = 0.436
      const ax = shape.x2 - headLength * Math.cos(angle - headAngle)
      const ay = shape.y2 - headLength * Math.sin(angle - headAngle)
      const bx = shape.x2 - headLength * Math.cos(angle + headAngle)
      const by = shape.y2 - headLength * Math.sin(angle + headAngle)
      const d = `M ${shape.x1} ${shape.y1} L ${shape.x2} ${shape.y2} M ${shape.x2} ${shape.y2} L ${ax.toFixed(2)} ${ay.toFixed(2)} M ${shape.x2} ${shape.y2} L ${bx.toFixed(2)} ${by.toFixed(2)}`
      return `<path ${base} d="${d}" />`
    }
  }
}
```

- [ ] **Step 4: Fix `svgToInkData` parsing**

In `src/ink/svgSerialiser.ts`, replace:

```ts
  const strokes: Stroke[] = []
  for (const el of doc.querySelectorAll('path[data-id]')) {
```

with:

```ts
  const strokes: Stroke[] = []
  for (const el of doc.querySelectorAll('path[data-id]:not([data-kind])')) {
```

Then replace:

```ts
  const shapes: Shape[] = []
  for (const selector of ['line[data-id]', 'rect[data-id]', 'ellipse[data-id]']) {
```

with:

```ts
  const shapes: Shape[] = []
  for (const selector of ['line[data-id]', 'rect[data-id]', 'ellipse[data-id]', 'path[data-kind="arrow"]']) {
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/ink/svgSerialiser.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/ink/svgSerialiser.ts src/ink/svgSerialiser.test.ts
git commit -m "fix: arrow shapes render with an arrowhead instead of an ellipse"
```

---

### Task 4: Eraser removes shapes, shape-drag no longer corrupts the stroke buffer, canvas repaints on data change — `src/ink/useInkCanvas.ts`

**Files:**
- Modify: `src/ink/useInkCanvas.ts` (full-file rewrite; the content below is the complete target state)

**Interfaces:**
- Consumes: `hitTestShape` from `./hitTest` (Task 1); `drawShapePreview`, `PreviewShape` from `./shapePreview` (Task 2).
- Produces: no public API changes — `useInkCanvas` still returns the same shape (`canvasRef, tool, setTool, color, setColor, size, setSize, inkData, undo, redo, canUndo, canRedo`) that `InkCanvas.tsx` already consumes.

- [ ] **Step 1: Replace the full contents of `src/ink/useInkCanvas.ts`**

```ts
import { useRef, useState, useEffect, useCallback } from 'react'
import { getStroke } from 'perfect-freehand'
import { inkApi } from '../lib/ink'
import { hitTestShape } from './hitTest'
import { drawShapePreview } from './shapePreview'
import type { PreviewShape } from './shapePreview'
import type { InkData, Stroke, Shape, Tool, Point } from './types'

export function useInkCanvas(svgPath: string, width: number, height: number) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#000000')
  const [size, setSize] = useState(4)
  const [inkData, setInkData] = useState<InkData>({ width, height, strokes: [], shapes: [] })

  const history = useRef<InkData[]>([])
  const future = useRef<InkData[]>([])
  const currentStroke = useRef<Point[]>([])
  const shapeStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    inkApi.read(svgPath).then((data) => {
      if (data) setInkData(data)
    })
  }, [svgPath])

  const commit = useCallback(
    (next: InkData) => {
      history.current.push(inkData)
      future.current = []
      setInkData(next)
      void inkApi.write(svgPath, next)
    },
    [inkData, svgPath],
  )

  const undo = useCallback(() => {
    const prev = history.current.pop()
    if (!prev) return
    future.current.push(inkData)
    setInkData(prev)
    void inkApi.write(svgPath, prev)
  }, [inkData, svgPath])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    history.current.push(inkData)
    setInkData(next)
    void inkApi.write(svgPath, next)
  }, [inkData, svgPath])

  const redrawCanvas = useCallback(
    (livePoints: Point[], liveShape?: PreviewShape | null) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (const stroke of inkData.strokes) {
        const pts = stroke.points.map((p) => [p.x, p.y, p.pressure])
        const outline = getStroke(pts, { size: stroke.size, thinning: 0.5, smoothing: 0.5, streamline: 0.5 })
        if (outline.length === 0) continue
        ctx.beginPath()
        ctx.fillStyle = stroke.color
        const first = outline[0]
        if (!first) continue
        ctx.moveTo(first[0] ?? 0, first[1] ?? 0)
        for (let i = 1; i < outline.length; i++) {
          const p = outline[i]
          if (p) ctx.lineTo(p[0] ?? 0, p[1] ?? 0)
        }
        ctx.closePath()
        ctx.fill()
      }

      for (const shape of inkData.shapes) {
        drawShapePreview(ctx, shape)
      }

      if (livePoints.length > 1) {
        const pts = livePoints.map((p) => [p.x, p.y, p.pressure])
        const outline = getStroke(pts, { size, thinning: 0.5, smoothing: 0.5, streamline: 0.5 })
        if (outline.length > 0) {
          const first = outline[0]
          if (first) {
            ctx.beginPath()
            ctx.fillStyle = color
            ctx.moveTo(first[0] ?? 0, first[1] ?? 0)
            for (let i = 1; i < outline.length; i++) {
              const p = outline[i]
              if (p) ctx.lineTo(p[0] ?? 0, p[1] ?? 0)
            }
            ctx.closePath()
            ctx.fill()
          }
        }
      }

      if (liveShape) {
        drawShapePreview(ctx, liveShape)
      }
    },
    [inkData, color, size],
  )

  useEffect(() => {
    redrawCanvas([])
  }, [inkData, redrawCanvas])

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      const activeTool = e.button === 5 ? 'eraser' : tool
      if (activeTool === 'eraser') return
      if (['line', 'circle', 'rect', 'arrow'].includes(activeTool)) {
        shapeStart.current = { x: e.offsetX, y: e.offsetY }
        return
      }
      currentStroke.current = [{ x: e.offsetX, y: e.offsetY, pressure: e.pressure }]
    },
    [tool],
  )

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      const activeTool = e.button === 5 ? 'eraser' : tool

      if (activeTool === 'eraser') {
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const eraseRadius = size * 3
        const survivingStrokes = inkData.strokes.filter((s) =>
          s.points.every((p) => Math.hypot(p.x - x, p.y - y) > eraseRadius),
        )
        const survivingShapes = inkData.shapes.filter((s) => !hitTestShape(s, x, y, eraseRadius))
        if (
          survivingStrokes.length !== inkData.strokes.length ||
          survivingShapes.length !== inkData.shapes.length
        ) {
          commit({ ...inkData, strokes: survivingStrokes, shapes: survivingShapes })
        }
        return
      }

      if (['line', 'circle', 'rect', 'arrow'].includes(activeTool)) {
        if (!shapeStart.current) return
        redrawCanvas([], {
          kind: activeTool as Shape['kind'],
          x1: shapeStart.current.x,
          y1: shapeStart.current.y,
          x2: e.offsetX,
          y2: e.offsetY,
          color,
          size,
        })
        return
      }

      const events = e.getCoalescedEvents?.() ?? [e]
      for (const ce of events) {
        currentStroke.current.push({ x: ce.offsetX, y: ce.offsetY, pressure: ce.pressure })
      }
      redrawCanvas(currentStroke.current)
    },
    [tool, inkData, size, color, commit, redrawCanvas],
  )

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      const activeTool = e.button === 5 ? 'eraser' : tool

      if (['line', 'circle', 'rect', 'arrow'].includes(activeTool) && shapeStart.current) {
        const shape: Shape = {
          id: crypto.randomUUID(),
          kind: activeTool as Shape['kind'],
          x1: shapeStart.current.x,
          y1: shapeStart.current.y,
          x2: e.offsetX,
          y2: e.offsetY,
          color,
          size,
        }
        shapeStart.current = null
        currentStroke.current = []
        commit({ ...inkData, shapes: [...inkData.shapes, shape] })
        return
      }

      if (currentStroke.current.length < 2) {
        currentStroke.current = []
        return
      }

      const stroke: Stroke = {
        id: crypto.randomUUID(),
        points: currentStroke.current,
        color,
        size,
      }
      currentStroke.current = []
      commit({ ...inkData, strokes: [...inkData.strokes, stroke] })
    },
    [tool, inkData, color, size, commit],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
    }
  }, [handlePointerDown, handlePointerMove, handlePointerUp])

  return {
    canvasRef,
    tool,
    setTool,
    color,
    setColor,
    size,
    setSize,
    inkData,
    undo,
    redo,
    canUndo: history.current.length > 0,
    canRedo: future.current.length > 0,
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Run the existing hook test suite as a regression check**

Run: `npm run test -- src/ink/useInkCanvas.test.ts`
Expected: PASS (4 tests) — these tests only cover initial state/tool-setting and don't exercise pointer events, so they confirm the hook's public API is unchanged.

- [ ] **Step 4: Run the full ink test suite**

Run: `npm run test -- src/ink`
Expected: PASS — all of `hitTest.test.ts`, `shapePreview.test.ts`, `svgSerialiser.test.ts`, `useInkCanvas.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/ink/useInkCanvas.ts
git commit -m "fix: eraser removes shapes, correct shape-drag preview, repaint on data change"
```

---

### Task 5: Eraser cursor — `src/ink/InkCanvas.tsx` and `src/index.css`

**Files:**
- Modify: `src/ink/InkCanvas.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `tool`, `size`, `canvasRef` already returned by `useInkCanvas` (Task 4 didn't change this shape).

- [ ] **Step 1: Replace the full contents of `src/ink/InkCanvas.tsx`**

```tsx
import { useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { PenLine, Eraser, Minus, Circle, Square, MoveUpRight, Undo2, Redo2 } from 'lucide-react'
import { useInkCanvas } from './useInkCanvas'
import type { Tool } from './types'

const TOOLS: { id: Tool; label: string; Icon: typeof PenLine }[] = [
  { id: 'pen', label: 'Pen', Icon: PenLine },
  { id: 'eraser', label: 'Eraser', Icon: Eraser },
  { id: 'line', label: 'Line', Icon: Minus },
  { id: 'circle', label: 'Circle', Icon: Circle },
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'arrow', label: 'Arrow', Icon: MoveUpRight },
]

interface InkCanvasProps {
  svgPath: string
  width: number
  height: number
}

export function InkCanvas({ svgPath, width, height }: InkCanvasProps) {
  const {
    canvasRef,
    tool,
    setTool,
    color,
    setColor,
    size,
    setSize,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useInkCanvas(svgPath, width, height)

  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'pen' || tool !== 'eraser') {
      if (cursorPos) setCursorPos(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  function handlePointerLeave() {
    setCursorPos(null)
  }

  const eraserDiameter = size * 6

  return (
    <div className="ink-canvas-wrap">
      <div className="ink-toolbar" role="toolbar" aria-label="Drawing tools">
        {TOOLS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`ink-tool${tool === id ? ' active' : ''}`}
            onClick={() => setTool(id)}
            aria-pressed={tool === id}
            aria-label={label}
            title={label}
          >
            <Icon size={15} />
          </button>
        ))}
        <span className="ink-sep" aria-hidden />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Stroke color"
        />
        <input
          type="range"
          min={1}
          max={20}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          aria-label="Stroke size"
        />
        <span className="ink-sep" aria-hidden />
        <button className="ink-tool" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo">
          <Undo2 size={15} />
        </button>
        <button className="ink-tool" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo">
          <Redo2 size={15} />
        </button>
      </div>
      <div
        style={{ position: 'relative', width, height }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="ink-canvas"
          style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
        />
        {cursorPos && (
          <div
            className="ink-eraser-cursor"
            style={{
              left: cursorPos.x,
              top: cursorPos.y,
              width: eraserDiameter,
              height: eraserDiameter,
            }}
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the eraser cursor CSS rule**

In `src/index.css`, find the final rule of the file:

```css
.ink-canvas {
  background: var(--bg-base);
}
```

Replace it with:

```css
.ink-canvas {
  background: var(--bg-base);
}

.ink-eraser-cursor {
  position: absolute;
  border: 1px solid var(--danger);
  border-radius: 50%;
  pointer-events: none;
  transform: translate(-50%, -50%);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/ink/InkCanvas.tsx src/index.css
git commit -m "feat: eraser cursor ring showing the actual erase radius"
```

---

### Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck and test run**

Run: `npm run typecheck && npm run test`
Expected: both exit 0, all test files pass (including the 2 new ones from Tasks 1-2 and the extended `svgSerialiser.test.ts` from Task 3).

- [ ] **Step 2: Manual QA walkthrough**

Run: `npm run tauri dev`. On a Windows machine with pen/stylus input (per this app's `pointerType === 'pen'` palm-rejection filter — mouse/touch input is intentionally ignored for drawing, matching existing behavior), walk through:
1. Open a note with existing ink content (or create one, draw something, close and reopen the note) — confirm the ink appears immediately, not blank.
2. Draw a line, circle, rectangle, and arrow. Confirm the arrow shows an actual arrowhead, and that each shape's live drag preview matches what commits on release (no stray freehand squiggle).
3. Draw a shape, then immediately draw a freehand stroke — confirm the stroke isn't corrupted by leftover points.
4. Switch to the eraser tool and hover over the canvas — confirm a ring appears at the pointer, sized proportionally to the current stroke-size slider.
5. Erase a placed shape of each kind (line/circle/rect/arrow) and a freehand stroke — confirm both are removable.
6. Undo and redo a few actions — confirm the canvas visibly updates each time (this exercises the new initial-paint effect).

Expected: no console errors in devtools; all six behaviors match the spec.

- [ ] **Step 3: Fix any issues found**

If Step 2 surfaces a problem, fix it in the relevant file, re-run Step 1, and commit as `fix: <description>`.

- [ ] **Step 4: Final commit (only if Step 3 produced changes)**

```bash
git add -A
git commit -m "fix: ink toolbar polish fixes from final QA pass"
```
