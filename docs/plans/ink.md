# null-notes Ink Subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline handwriting to null-notes: a TipTap block node backed by a Canvas+perfect-freehand drawing surface that commits strokes to SVG sidecars on disk, with pen/eraser/shape tools and full undo/redo.

**Architecture:** The InkBlock TipTap extension renders a React NodeView that hosts an `<InkCanvas>` component. While drawing, perfect-freehand smooths strokes on a `<canvas>` at 60fps. On `pointerup`, each stroke is committed as an SVG `<path>` element written to a `.ink/<name>.svg` sidecar file via a Tauri IPC call. The SVG is the source of truth; the canvas is a rendering accelerator.

**Tech Stack:** Tauri 2, perfect-freehand, Canvas API, Pointer Events API, TipTap 2 NodeView, React, TypeScript strict

**Prerequisite:** Foundation plan complete — Tauri scaffold, SQLite, note CRUD, TipTap editor, hooks, and UI all in place.

## Global Constraints

- Tauri 2 only — `@tauri-apps/api/core` for `invoke`
- TypeScript strict mode — no `any`
- No `.unwrap()` / `.expect()` outside `#[cfg(test)]` in Rust
- `cargo clippy -- -D warnings` must pass clean
- All Tauri commands return `Result<T, String>`
- Ink sidecar path: `<note-name-without-extension>.ink/<sketch-id>.svg` (relative, same directory as `.md`)
- Strokes stored as individual `<path>` elements — never merged — so per-stroke erase works without geometry parsing
- `pointerType === "pen"` filter — ignore touch/mouse while in ink mode
- Physical eraser tip: `button === 5` on `pointerdown`
- `getCoalescedEvents()` for high-frequency input capture
- perfect-freehand for stroke smoothing and pressure curve

---

## File Map

### src-tauri/

| File | Responsibility |
|---|---|
| `src/commands/ink.rs` | `read_ink`, `write_ink`, `ensure_ink_dir` Tauri commands |
| `src/commands/mod.rs` | Add `pub mod ink` |
| `src/main.rs` | Register ink commands in invoke handler |

### src/ (frontend)

| File | Responsibility |
|---|---|
| `lib/ink.ts` | Typed `invoke` wrappers for ink commands |
| `ink/types.ts` | `Stroke`, `Shape`, `InkData`, `Tool` types |
| `ink/svgSerialiser.ts` | `strokeToPath`, `shapeToElement`, `inkDataToSvg`, `svgToInkData` |
| `ink/useInkCanvas.ts` | Hook — pointer events, perfect-freehand, undo/redo stack |
| `ink/InkCanvas.tsx` | Canvas/SVG composite component |
| `editor/extensions/InkBlock.ts` | TipTap node extension — schema, Markdown directive, NodeView |

---

## Task 1: Rust Ink Commands

**Files:**
- Create: `src-tauri/src/commands/ink.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- Produces Tauri commands: `read_ink(path: String) -> Result<String, String>`, `write_ink(path: String, svg: String) -> Result<(), String>`, `ensure_ink_dir(note_path: String) -> Result<String, String>`

- [ ] **Step 1: Create `src-tauri/src/commands/ink.rs`** with stubs and tests

```rust
use std::path::Path;

fn ink_dir_for(note_path: &str) -> String {
    let p = Path::new(note_path);
    let stem = p.file_stem().unwrap_or_default().to_string_lossy();
    let dir = p.parent().unwrap_or(Path::new("."));
    dir.join(format!("{}.ink", stem))
        .to_string_lossy()
        .into_owned()
}

#[tauri::command]
pub async fn ensure_ink_dir(note_path: String) -> Result<String, String> {
    let dir = ink_dir_for(&note_path);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn read_ink(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_ink(path: String, svg: String) -> Result<(), String> {
    tokio::fs::write(&path, svg)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_ink_dir_for() {
        let dir = ink_dir_for("/ws/Lecture 7.md");
        assert!(dir.ends_with("Lecture 7.ink"));
    }

    #[tokio::test]
    async fn test_ensure_ink_dir_creates_directory() {
        let tmp = tempdir().unwrap();
        let note_path = tmp.path().join("Note.md").to_string_lossy().into_owned();
        let ink_dir = ensure_ink_dir(note_path).await.unwrap();
        assert!(std::path::Path::new(&ink_dir).is_dir());
    }

    #[tokio::test]
    async fn test_write_and_read_ink() {
        let tmp = tempdir().unwrap();
        let svg_path = tmp.path().join("sketch-1.svg").to_string_lossy().into_owned();
        write_ink(svg_path.clone(), "<svg></svg>".into()).await.unwrap();
        let content = read_ink(svg_path).await.unwrap();
        assert_eq!(content, "<svg></svg>");
    }
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::ink
```

Expected: all 3 tests pass.

- [ ] **Step 3: Add `pub mod ink` to `src-tauri/src/commands/mod.rs`**

```rust
pub mod ink;
pub mod notes;
pub mod workspace;
```

- [ ] **Step 4: Register ink commands in `src-tauri/src/main.rs`**

Add to the `invoke_handler`:

```rust
commands::ink::ensure_ink_dir,
commands::ink::read_ink,
commands::ink::write_ink,
```

- [ ] **Step 5: Clippy and commit**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git add src-tauri/src/commands/ink.rs src-tauri/src/commands/mod.rs src-tauri/src/main.rs
git commit -m "feat: Rust ink file commands"
```

---

## Task 2: TypeScript Ink API and Types

**Files:**
- Create: `src/ink/types.ts`
- Create: `src/lib/ink.ts`

**Interfaces:**
- Produces: `Stroke`, `Shape`, `InkData`, `Tool` types; `inkApi` with `readInk`, `writeInk`, `ensureInkDir`

- [ ] **Step 1: Write `src/ink/types.ts`**

```ts
export type Tool = 'pen' | 'eraser' | 'line' | 'circle' | 'rect' | 'arrow'

export interface Point {
  x: number
  y: number
  pressure: number
}

export interface Stroke {
  id: string
  points: Point[]
  color: string
  size: number
}

export interface Shape {
  id: string
  kind: 'line' | 'circle' | 'rect' | 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  size: number
}

export interface InkData {
  width: number
  height: number
  strokes: Stroke[]
  shapes: Shape[]
}
```

- [ ] **Step 2: Write `src/lib/ink.ts`**

```ts
import { invoke } from '@tauri-apps/api/core'
import type { InkData } from '../ink/types'
import { inkDataToSvg, svgToInkData } from '../ink/svgSerialiser'

export const inkApi = {
  ensureDir: (notePath: string) =>
    invoke<string>('ensure_ink_dir', { notePath }),

  read: async (path: string): Promise<InkData | null> => {
    try {
      const svg = await invoke<string>('read_ink', { path })
      return svgToInkData(svg)
    } catch {
      return null
    }
  },

  write: async (path: string, data: InkData): Promise<void> => {
    const svg = inkDataToSvg(data)
    await invoke<void>('write_ink', { path, svg })
  },
}
```

- [ ] **Step 3: Commit**

```bash
git add src/ink/types.ts src/lib/ink.ts
git commit -m "feat: TypeScript ink API types and wrappers"
```

---

## Task 3: SVG Stroke and Shape Serialisers

**Files:**
- Create: `src/ink/svgSerialiser.ts`
- Create: `src/ink/svgSerialiser.test.ts`

**Interfaces:**
- Consumes: `InkData`, `Stroke`, `Shape` (Task 2)
- Produces: `strokeToPath(stroke: Stroke): string`, `shapeToElement(shape: Shape): string`, `inkDataToSvg(data: InkData): string`, `svgToInkData(svg: string): InkData`

- [ ] **Step 1: Install perfect-freehand**

```bash
npm install perfect-freehand
```

- [ ] **Step 2: Write failing tests in `src/ink/svgSerialiser.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { strokeToPath, shapeToElement, inkDataToSvg, svgToInkData } from './svgSerialiser'
import type { Stroke, Shape, InkData } from './types'

const stroke: Stroke = {
  id: 's1',
  points: [
    { x: 10, y: 10, pressure: 0.5 },
    { x: 20, y: 20, pressure: 0.6 },
    { x: 30, y: 15, pressure: 0.4 },
  ],
  color: '#000000',
  size: 4,
}

const shape: Shape = {
  id: 'sh1',
  kind: 'rect',
  x1: 10, y1: 10, x2: 100, y2: 80,
  color: '#ff0000',
  size: 2,
}

describe('strokeToPath', () => {
  it('returns an SVG path element string', () => {
    const result = strokeToPath(stroke)
    expect(result).toContain('<path')
    expect(result).toContain('data-id="s1"')
    expect(result).toContain('fill="#000000"')
  })
})

describe('shapeToElement', () => {
  it('returns a rect element for rect kind', () => {
    const result = shapeToElement(shape)
    expect(result).toContain('<rect')
    expect(result).toContain('data-id="sh1"')
    expect(result).toContain('stroke="#ff0000"')
  })

  it('returns a line element for line kind', () => {
    const line: Shape = { ...shape, id: 'sh2', kind: 'line' }
    const result = shapeToElement(line)
    expect(result).toContain('<line')
  })

  it('returns a circle element for circle kind', () => {
    const circle: Shape = { ...shape, id: 'sh3', kind: 'circle' }
    const result = shapeToElement(circle)
    expect(result).toContain('<ellipse')
  })
})

describe('inkDataToSvg / svgToInkData roundtrip', () => {
  it('round-trips stroke data', () => {
    const data: InkData = {
      width: 800,
      height: 600,
      strokes: [stroke],
      shapes: [shape],
    }
    const svg = inkDataToSvg(data)
    expect(svg).toContain('<svg')
    expect(svg).toContain('data-width="800"')

    const restored = svgToInkData(svg)
    expect(restored.strokes).toHaveLength(1)
    expect(restored.strokes[0]?.id).toBe('s1')
    expect(restored.shapes).toHaveLength(1)
    expect(restored.shapes[0]?.id).toBe('sh1')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm run test -- svgSerialiser.test
```

Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/ink/svgSerialiser.ts`**

```ts
import { getStroke } from 'perfect-freehand'
import type { InkData, Stroke, Shape } from './types'

function pointsToSvgPath(points: number[][]): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points
  if (!first) return ''
  const d = [`M ${first[0]?.toFixed(2)} ${first[1]?.toFixed(2)}`]
  for (const p of rest) {
    d.push(`L ${p[0]?.toFixed(2)} ${p[1]?.toFixed(2)}`)
  }
  d.push('Z')
  return d.join(' ')
}

export function strokeToPath(stroke: Stroke): string {
  const inputPoints = stroke.points.map((p) => [p.x, p.y, p.pressure])
  const outlinePoints = getStroke(inputPoints, {
    size: stroke.size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  })
  const d = pointsToSvgPath(outlinePoints)
  const raw = JSON.stringify(stroke.points)
  return `<path data-id="${stroke.id}" data-points="${encodeURIComponent(raw)}" data-color="${stroke.color}" data-size="${stroke.size}" d="${d}" fill="${stroke.color}" />`
}

export function shapeToElement(shape: Shape): string {
  const base = `data-id="${shape.id}" data-kind="${shape.kind}" data-x1="${shape.x1}" data-y1="${shape.y1}" data-x2="${shape.x2}" data-y2="${shape.y2}" data-color="${shape.color}" data-size="${shape.size}" stroke="${shape.color}" stroke-width="${shape.size}" fill="none"`
  switch (shape.kind) {
    case 'line':
      return `<line ${base} x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" />`
    case 'rect': {
      const x = Math.min(shape.x1, shape.x2)
      const y = Math.min(shape.y1, shape.y2)
      const w = Math.abs(shape.x2 - shape.x1)
      const h = Math.abs(shape.y2 - shape.y1)
      return `<rect ${base} x="${x}" y="${y}" width="${w}" height="${h}" />`
    }
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

export function inkDataToSvg(data: InkData): string {
  const paths = data.strokes.map(strokeToPath).join('\n  ')
  const elements = data.shapes.map(shapeToElement).join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" data-width="${data.width}" data-height="${data.height}" width="${data.width}" height="${data.height}" viewBox="0 0 ${data.width} ${data.height}">
  ${paths}
  ${elements}
</svg>`
}

export function svgToInkData(svg: string): InkData {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svg, 'image/svg+xml')
  const root = doc.querySelector('svg')

  const width = Number(root?.getAttribute('data-width') ?? 800)
  const height = Number(root?.getAttribute('data-height') ?? 600)

  const strokes: Stroke[] = []
  for (const el of doc.querySelectorAll('path[data-id]')) {
    const id = el.getAttribute('data-id') ?? ''
    const color = el.getAttribute('data-color') ?? '#000000'
    const size = Number(el.getAttribute('data-size') ?? 4)
    const raw = el.getAttribute('data-points') ?? '[]'
    const points = JSON.parse(decodeURIComponent(raw)) as Stroke['points']
    strokes.push({ id, points, color, size })
  }

  const shapeSelectors = ['line[data-id]', 'rect[data-id]', 'ellipse[data-id]']
  const shapes: Shape[] = []
  for (const selector of shapeSelectors) {
    for (const el of doc.querySelectorAll(selector)) {
      shapes.push({
        id: el.getAttribute('data-id') ?? '',
        kind: el.getAttribute('data-kind') as Shape['kind'],
        x1: Number(el.getAttribute('data-x1') ?? 0),
        y1: Number(el.getAttribute('data-y1') ?? 0),
        x2: Number(el.getAttribute('data-x2') ?? 0),
        y2: Number(el.getAttribute('data-y2') ?? 0),
        color: el.getAttribute('data-color') ?? '#000000',
        size: Number(el.getAttribute('data-size') ?? 2),
      })
    }
  }

  return { width, height, strokes, shapes }
}
```

- [ ] **Step 5: Run tests**

```bash
npm run test -- svgSerialiser.test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ink/
git commit -m "feat: SVG stroke/shape serialisers with round-trip"
```

---

## Task 4: useInkCanvas Hook

**Files:**
- Create: `src/ink/useInkCanvas.ts`
- Create: `src/ink/useInkCanvas.test.ts`

**Interfaces:**
- Consumes: `InkData`, `Tool`, `Stroke`, `Shape`, `inkApi` (Tasks 2-3)
- Produces: `useInkCanvas(svgPath, width, height)` → `{ canvasRef, tool, setTool, color, setColor, size, setSize, inkData, undo, redo, canUndo, canRedo }`

- [ ] **Step 1: Write failing tests in `src/ink/useInkCanvas.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInkCanvas } from './useInkCanvas'

vi.mock('../lib/ink', () => ({
  inkApi: {
    read: vi.fn().mockResolvedValue(null),
    write: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('useInkCanvas', () => {
  it('initialises with empty ink data', async () => {
    const { result } = renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', 800, 600))
    await act(async () => {})
    expect(result.current.inkData.strokes).toHaveLength(0)
    expect(result.current.inkData.shapes).toHaveLength(0)
  })

  it('starts with pen tool', () => {
    const { result } = renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', 800, 600))
    expect(result.current.tool).toBe('pen')
  })

  it('canUndo is false initially', async () => {
    const { result } = renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', 800, 600))
    await act(async () => {})
    expect(result.current.canUndo).toBe(false)
  })

  it('setTool updates tool', () => {
    const { result } = renderHook(() => useInkCanvas('/ws/n.ink/s1.svg', 800, 600))
    act(() => result.current.setTool('eraser'))
    expect(result.current.tool).toBe('eraser')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test -- useInkCanvas.test
```

- [ ] **Step 3: Implement `src/ink/useInkCanvas.ts`**

```ts
import { useRef, useState, useEffect, useCallback } from 'react'
import { getStroke } from 'perfect-freehand'
import { inkApi } from '../lib/ink'
import type { InkData, Stroke, Shape, Tool, Point } from './types'
import { inkDataToSvg } from './svgSerialiser'

const EMPTY: InkData = { width: 0, height: 0, strokes: [], shapes: [] }

export function useInkCanvas(svgPath: string, width: number, height: number) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#000000')
  const [size, setSize] = useState(4)
  const [inkData, setInkData] = useState<InkData>({ ...EMPTY, width, height })

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
    (livePoints: Point[]) => {
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
        const [first, ...rest] = outline
        if (!first) continue
        ctx.moveTo(first[0] ?? 0, first[1] ?? 0)
        for (const p of rest) ctx.lineTo(p[0] ?? 0, p[1] ?? 0)
        ctx.closePath()
        ctx.fill()
      }

      if (livePoints.length > 1) {
        const pts = livePoints.map((p) => [p.x, p.y, p.pressure])
        const outline = getStroke(pts, { size, thinning: 0.5, smoothing: 0.5, streamline: 0.5 })
        if (outline.length > 0) {
          ctx.beginPath()
          ctx.fillStyle = color
          const [first, ...rest] = outline
          if (!first) return
          ctx.moveTo(first[0] ?? 0, first[1] ?? 0)
          for (const p of rest) ctx.lineTo(p[0] ?? 0, p[1] ?? 0)
          ctx.closePath()
          ctx.fill()
        }
      }
    },
    [inkData, color, size],
  )

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
        const rect = canvasRef.current?.getBoundingClientRect()
        if (!rect) return
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const surviving = inkData.strokes.filter((s) =>
          s.points.every((p) => Math.hypot(p.x - x, p.y - y) > size * 3),
        )
        if (surviving.length !== inkData.strokes.length) {
          const next = { ...inkData, strokes: surviving }
          commit(next)
        }
        return
      }

      const events = e.getCoalescedEvents?.() ?? [e]
      for (const ce of events) {
        currentStroke.current.push({ x: ce.offsetX, y: ce.offsetY, pressure: ce.pressure })
      }
      redrawCanvas(currentStroke.current)
    },
    [tool, inkData, size, commit, redrawCanvas],
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

- [ ] **Step 4: Run tests**

```bash
npm run test -- useInkCanvas.test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ink/useInkCanvas.ts src/ink/useInkCanvas.test.ts
git commit -m "feat: useInkCanvas hook with undo/redo and eraser"
```

---

## Task 5: InkCanvas Component

**Files:**
- Create: `src/ink/InkCanvas.tsx`

**Interfaces:**
- Consumes: `useInkCanvas` (Task 4)
- Produces: `<InkCanvas svgPath={string} width={number} height={number} />` — self-contained drawing surface with toolbar

- [ ] **Step 1: Write `src/ink/InkCanvas.tsx`**

```tsx
import { useInkCanvas } from './useInkCanvas'
import type { Tool } from './types'

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'pen', label: 'Pen' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'line', label: 'Line' },
  { id: 'circle', label: 'Circle' },
  { id: 'rect', label: 'Rect' },
  { id: 'arrow', label: 'Arrow' },
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
    inkData,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useInkCanvas(svgPath, width, height)

  return (
    <div className="ink-canvas-wrap">
      <div className="ink-toolbar" role="toolbar" aria-label="Drawing tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`ink-tool${tool === t.id ? ' active' : ''}`}
            onClick={() => setTool(t.id)}
            aria-pressed={tool === t.id}
          >
            {t.label}
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
        <button onClick={undo} disabled={!canUndo} aria-label="Undo">↩</button>
        <button onClick={redo} disabled={!canRedo} aria-label="Redo">↪</button>
      </div>
      <div className="ink-canvas-container" style={{ position: 'relative', width, height }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="ink-canvas"
          style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
        />
        <svg
          width={width}
          height={height}
          className="ink-svg"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          viewBox={`0 0 ${width} ${height}`}
        >
          {inkData.strokes.map((s) => (
            <g key={s.id} data-stroke-id={s.id} />
          ))}
        </svg>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ink/InkCanvas.tsx
git commit -m "feat: InkCanvas component with toolbar"
```

---

## Task 6: InkBlock TipTap Extension

**Files:**
- Create: `src/editor/extensions/InkBlock.ts`
- Modify: `src/editor/extensions/index.ts`

**Interfaces:**
- Consumes: `InkCanvas` component (Task 5)
- Produces: `InkBlock` TipTap Node extension; registered in `coreExtensions`
- Markdown serialization: `:::ink{src=<path> width=<n> height=<n>}` directive

- [ ] **Step 1: Write `src/editor/extensions/InkBlock.ts`**

```ts
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { InkCanvas } from '../../ink/InkCanvas'

export const InkBlock = Node.create({
  name: 'inkBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      width: { default: 800 },
      height: { default: 400 },
      locked: { default: false },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="ink-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'ink-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(({ node }) => {
      const { src, width, height } = node.attrs as {
        src: string
        width: number
        height: number
      }
      if (!src) return null
      return <InkCanvas svgPath={src} width={width} height={height} />
    })
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: Record<string, unknown> }) {
          const { src, width, height } = node.attrs
          state.write(`:::ink{src=${src} width=${width} height=${height}}\n`)
        },
        parse: {
          setup(this: { addNode: (name: string, regex: RegExp, fn: (match: RegExpMatchArray) => object) => void) {
            this.addNode(
              'inkBlock',
              /^:::ink\{src=([^\s}]+)\s+width=(\d+)\s+height=(\d+)\}/,
              (match) => ({
                src: match[1],
                width: Number(match[2]),
                height: Number(match[3]),
              }),
            )
          },
        },
      },
    }
  },
})
```

- [ ] **Step 2: Add InkBlock to `src/editor/extensions/index.ts`**

```ts
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import Placeholder from '@tiptap/extension-placeholder'
import { InkBlock } from './InkBlock'

export const coreExtensions = [
  StarterKit,
  Markdown.configure({
    html: false,
    transformPastedText: true,
    transformCopiedText: true,
  }),
  Placeholder.configure({
    placeholder: 'Start writing…',
  }),
  InkBlock,
]
```

- [ ] **Step 3: Typecheck and build**

```bash
npm run typecheck
npm run tauri dev
```

Expected: TypeScript passes; app opens. Insert an ink block by typing `:::ink{src=test.ink/s1.svg width=800 height=400}` in a note and confirm the canvas renders.

- [ ] **Step 4: Commit**

```bash
git add src/editor/extensions/InkBlock.ts src/editor/extensions/index.ts
git commit -m "feat: InkBlock TipTap extension with Markdown round-trip"
```
