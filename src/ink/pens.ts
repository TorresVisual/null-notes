import type { Pen } from './types'

// Two nibs, two colours, two highlighters — enough to take a lecture without
// opening a picker. The ink colours suit the near-black page; the highlighters
// are wide and translucent so they read as a wash, not a stripe.
export const DEFAULT_PENS: [Pen, ...Pen[]] = [
  { id: 'fine', label: 'Fine', color: '#e6edf3', size: 2, opacity: 1 },
  { id: 'broad', label: 'Broad', color: '#e6edf3', size: 5, opacity: 1 },
  { id: 'red', label: 'Red', color: '#ff7b72', size: 2, opacity: 1 },
  { id: 'blue', label: 'Blue', color: '#79c0ff', size: 2, opacity: 1 },
  { id: 'highlight-yellow', label: 'Yellow highlighter', color: '#e3b341', size: 20, opacity: 0.3 },
  { id: 'highlight-green', label: 'Green highlighter', color: '#7ee787', size: 20, opacity: 0.3 },
]

function isPen(value: unknown): value is Pen {
  if (typeof value !== 'object' || value === null) return false
  const pen = value as Record<string, unknown>
  return (
    typeof pen.id === 'string' &&
    typeof pen.label === 'string' &&
    typeof pen.color === 'string' &&
    typeof pen.size === 'number' &&
    typeof pen.opacity === 'number'
  )
}

// Stored presets come back as whatever was written last — an older build's
// shape, or a hand-edited config. Anything that is not a complete set of pens
// falls back to the defaults rather than half-loading a broken toolbar.
export function parsePens(raw: string | null): Pen[] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return parsed.every(isPen) ? (parsed as Pen[]) : null
  } catch {
    return null
  }
}

export function withPen(pens: Pen[], updated: Pen): Pen[] {
  return pens.map((pen) => (pen.id === updated.id ? updated : pen))
}

// Presets belong to the person, not the note, so they cannot live in the .md or
// the sidecar. Until the settings surface (ROADMAP P2-1) exists they live in
// webview storage — every read and write of them goes through this pair, so
// moving them to the config file later is a change to these four functions.
const PENS_KEY = 'null-notes.ink.pens'
const ACTIVE_PEN_KEY = 'null-notes.ink.activePen'
const ERASER_SIZE_KEY = 'null-notes.ink.eraserSize'

// The eraser is sized in page units, as a diameter — what you see under the
// cursor is what it takes. It is deliberately not tied to the pen: you write
// fine and rub out broadly, and one slider for both made that impossible.
export const DEFAULT_ERASER_SIZE = 12
const MIN_ERASER_SIZE = 4
const MAX_ERASER_SIZE = 80

export function clampEraserSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_ERASER_SIZE
  return Math.min(MAX_ERASER_SIZE, Math.max(MIN_ERASER_SIZE, size))
}

export function loadPens(): Pen[] {
  return parsePens(localStorage.getItem(PENS_KEY)) ?? DEFAULT_PENS
}

export function savePens(pens: Pen[]): void {
  localStorage.setItem(PENS_KEY, JSON.stringify(pens))
}

export function loadActivePenId(pens: Pen[]): string {
  const stored = localStorage.getItem(ACTIVE_PEN_KEY)
  const known = pens.some((pen) => pen.id === stored)
  return known && stored ? stored : (pens[0]?.id ?? '')
}

export function saveActivePenId(id: string): void {
  localStorage.setItem(ACTIVE_PEN_KEY, id)
}

export function loadEraserSize(): number {
  return clampEraserSize(Number(localStorage.getItem(ERASER_SIZE_KEY)))
}

export function saveEraserSize(size: number): void {
  localStorage.setItem(ERASER_SIZE_KEY, String(clampEraserSize(size)))
}
