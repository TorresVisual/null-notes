export type Tool = 'pen' | 'eraser' | 'lasso' | 'line' | 'circle' | 'rect' | 'arrow' | 'text'

// Two ways to rub out: take only what the eraser passes over, or take the whole
// stroke it touches. Scratching out a word wants the second; fixing one letter
// of it wants the first.
export type EraserMode = 'point' | 'stroke'

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
  opacity: number
  /** perfect-freehand's own `thinning` option, captured from the pen that
   *  drew it (P13-2) — low values (the pencil preset) hold a near-constant
   *  width regardless of pressure; `undefined` behaves as 0.5, the one
   *  value every pen/highlighter drew with before this existed. Per-stroke,
   *  not read from whichever pen is currently active, so a stroke's own
   *  look never changes retroactively when presets are edited later. */
  thinning?: number
}

// A pen is a saved colour/width/opacity. A highlighter is not a separate tool —
// it is a pen that is wide and translucent, which is the whole difference. A
// pencil (P13-2) is the same idea again: `thinning` alone, pushed low, reads
// as a harder, more uniform-width line without needing a second rendering
// path — the same "preset, not a new subsystem" shape.
export interface Pen {
  id: string
  label: string
  color: string
  size: number
  opacity: number
  thinning?: number
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

// A typed label, not a stroke — placed at a point rather than drawn along a
// path. `size` is a font size in px, frozen per item from the toolbar's own
// (pen-independent) text-size setting at creation time — the same "freeze it
// per-item" posture P13-2 gave `thinning`, and independent of pen stroke
// width for the same reason eraser size already is (`ink/pens.ts`): a
// comfortable line width and a legible font size are different scales.
export interface TextItem {
  id: string
  x: number
  y: number
  text: string
  color: string
  size: number
}

export interface InkData {
  width: number
  height: number
  strokes: Stroke[]
  shapes: Shape[]
  texts: TextItem[]
}
