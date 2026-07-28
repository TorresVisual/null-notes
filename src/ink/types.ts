export type Tool = 'pen' | 'eraser' | 'lasso' | 'line' | 'circle' | 'rect' | 'arrow'

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
}

// A pen is a saved colour/width/opacity. A highlighter is not a separate tool —
// it is a pen that is wide and translucent, which is the whole difference.
export interface Pen {
  id: string
  label: string
  color: string
  size: number
  opacity: number
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
