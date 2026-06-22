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
