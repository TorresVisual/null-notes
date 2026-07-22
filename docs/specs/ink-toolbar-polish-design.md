# null-notes — Ink Toolbar & Canvas Polish Design

**Date:** 2026-07-22
**Scope:** Second of four planned polish passes (visual design system → **ink toolbar & canvas polish** → editor feel → navigation). Fixes functional bugs in the ink drawing pipeline uncovered while scoping this project, plus one UX affordance (eraser cursor).

---

## Goals

- Fix four functional bugs found in the current ink implementation that directly undermine "does this tool feel good to use":
  1. The Arrow tool renders as a plain ellipse (no arrowhead) — `shapeToElement` has no dedicated `arrow` case and falls through to the `circle` branch.
  2. Shapes (line/circle/rect/arrow) can never be erased — the eraser only filters `inkData.strokes`; `inkData.shapes` is untouched.
  3. Dragging a shape tool shows an incorrect live preview — `pointermove` still pushes points into the freehand `currentStroke` buffer during a shape drag and redraws it as ink, instead of showing a proper shape ghost.
  4. That buffer leaks — after a shape commits, `currentStroke.current` is never cleared, so leftover points can corrupt the next freehand stroke drawn afterward.
- Add an eraser cursor: a visible ring at the actual erase radius, since erasing today is invisible until strokes vanish.

## Non-Goals

- No new tool types, no canvas resizing/reflow, no stroke-size preview UI, no color presets — all explicitly deferred; this pass is bugs + eraser cursor only.
- No segment-level erase (still v2 per `docs/specs/tech-stack-design.md`).
- No changes to the visual design system tokens/icons from the prior pass — this project only touches ink-specific logic and one new CSS class for the cursor ring.

---

## Bug Fixes

### 1. Arrow rendering

`src/ink/svgSerialiser.ts` — `shapeToElement` gets a dedicated `arrow` case producing a single `<path data-kind="arrow">` element combining the line and an open two-stroke arrowhead:

```
M x1 y1 L x2 y2 M x2 y2 L headAx headAy M x2 y2 L headBx headBy
```

where the head points are computed from the line's angle, a fixed head length (`min(18, distance * 0.4)`), and a ±25° spread — rendered `stroke="{color}" stroke-width="{size}" fill="none"`, matching how line/rect/circle already render.

### 2. Shape erasability

New pure module `src/ink/hitTest.ts`:
- `pointToSegmentDistance(px, py, x1, y1, x2, y2): number`
- `hitTestShape(shape: Shape, x: number, y: number, radius: number): boolean` — line/arrow use segment distance; rect uses the minimum distance to its 4 edges (reusing the segment helper); circle uses an ellipse-ring distance approximation (`|distToCenterNormalized - 1| * min(rx, ry) <= radius`).

`src/ink/useInkCanvas.ts`'s eraser branch filters `inkData.shapes` through `hitTestShape` alongside the existing stroke filter, committing if either collection changed.

### 3 & 4. Live shape preview and buffer leak

New pure module `src/ink/shapePreview.ts`:
- `drawShapePreview(ctx: CanvasRenderingContext2D, shape: { kind, x1, y1, x2, y2, color, size }): void` — mirrors `shapeToElement`'s per-kind logic (line, rect via path, circle via `ctx.ellipse`, arrow via line + two head segments) but issues canvas 2D calls instead of building SVG markup.

`src/ink/useInkCanvas.ts` changes:
- `handlePointerMove` no longer pushes points into `currentStroke.current` when the active tool is a shape tool. Instead it tracks the live end point and calls `redrawCanvas` with an optional in-progress shape, which `redrawCanvas` draws via `drawShapePreview` after existing strokes/shapes.
- `handlePointerUp` clears `currentStroke.current = []` after committing a shape (closing the leak) in addition to clearing `shapeStart.current`.

---

## Eraser Cursor

`src/ink/InkCanvas.tsx` tracks pointer position locally (component state, pen-input only — matching the existing `pointerType === 'pen'` palm-rejection filter used elsewhere) via the same `canvasRef` the hook already exposes. No changes to the hook's public API.

Renders an absolutely-positioned ring `<div className="ink-eraser-cursor">` over the canvas when `tool === 'eraser'` and the pen is hovering it, sized to `size * 6` (diameter, matching the real `size * 3` erase-hit radius used in `useInkCanvas.ts`) so the visible cursor matches what will actually be erased. New CSS:

```css
.ink-eraser-cursor {
  position: absolute;
  border: 1px solid var(--danger);
  border-radius: 50%;
  pointer-events: none;
  transform: translate(-50%, -50%);
}
```

---

## File Structure

| File | Change |
|---|---|
| `src/ink/svgSerialiser.ts` | Add `arrow` case to `shapeToElement`; update `svgToInkData` parsing to distinguish stroke paths from arrow-shape paths |
| `src/ink/hitTest.ts` | New — pure hit-testing functions |
| `src/ink/shapePreview.ts` | New — pure canvas-drawing function for live shape preview |
| `src/ink/useInkCanvas.ts` | Eraser filters shapes too; shape-drag no longer pollutes `currentStroke`; buffer cleared after shape commit; `redrawCanvas` draws live shape preview |
| `src/ink/InkCanvas.tsx` | Local pointer-position state for the eraser cursor overlay |
| `src/index.css` | New `.ink-eraser-cursor` rule |

No files are deleted.

---

## Testing

- `src/ink/hitTest.ts` and `src/ink/shapePreview.ts` (new files) get full unit tests — pure logic, `shapePreview.ts` tested against a mock `CanvasRenderingContext2D`-shaped object since jsdom has no real canvas implementation.
- `src/ink/svgSerialiser.test.ts` gains cases for the arrow `shapeToElement` output and a round-trip test with both a stroke and an arrow shape in the same SVG, asserting the parser doesn't cross-contaminate the two (regression test for the `data-kind` distinction).
- The pointer-event wiring inside `useInkCanvas.ts` (eraser now also removing shapes; buffer clearing after shape commit) is **not** unit-tested with simulated `PointerEvent`s — this matches existing precedent in the codebase, where the hook's pointer-driven logic already has zero such coverage today. These two fixes are verified via manual QA instead.
- `npm run typecheck` after each task; `npm run test` for the full suite at the end.
- Manual QA walkthrough in `npm run tauri dev`: draw an arrow (confirm arrowhead renders and survives a save/reload round-trip), erase a placed shape of each kind, drag each shape tool and confirm the preview matches what commits, draw a shape then immediately a freehand stroke and confirm the stroke isn't corrupted, and hover the eraser tool to confirm the cursor ring appears at the correct size and position.

---

## Sequencing Note

This is project 2 of 4 in the "make the app awesome" polish effort. Project 1 (visual design system) is complete and merged. Projects 3 (editor feel) and 4 (navigation & organization) each get their own brainstorming → spec → plan cycle once this one ships.
