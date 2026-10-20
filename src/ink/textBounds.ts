import type { Bounds } from './growCanvas'
import type { TextItem } from './types'

export const TEXT_LINE_HEIGHT = 1.2

// A canvas 2D context can measure text exactly, but hit-testing needs to run
// from a plain click position with no guarantee a context is even mounted yet
// (or, in a test, mounted at all) — so width is an estimate, not a measurement,
// the same trade-off `hitTest.ts` already makes for shapes with pure geometry.
const AVG_CHAR_WIDTH_RATIO = 0.55

export interface TextBounds {
  x: number
  y: number
  width: number
  height: number
}

export function measureTextItem(item: TextItem): TextBounds {
  const lines = item.text.length > 0 ? item.text.split('\n') : ['']
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const width = Math.max(longest * item.size * AVG_CHAR_WIDTH_RATIO, item.size)
  const height = lines.length * item.size * TEXT_LINE_HEIGHT
  return { x: item.x, y: item.y, width, height }
}

export function pointInTextItem(item: TextItem, x: number, y: number): boolean {
  const bounds = measureTextItem(item)
  return (
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height
  )
}

export function translateTextItem(item: TextItem, dx: number, dy: number): TextItem {
  return { ...item, x: item.x + dx, y: item.y + dy }
}

// A text item's far corner, not its origin — a multi-line label's own bottom
// edge can cross the grow margin even when the (x, y) it was placed at
// doesn't, which the origin-only reach P13-3 shipped with missed.
export function boundsOfTextItem(item: TextItem): Bounds {
  const bounds = measureTextItem(item)
  return { minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.width, maxY: bounds.y + bounds.height }
}
