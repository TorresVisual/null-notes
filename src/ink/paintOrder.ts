import type { Stroke } from './types'

// A highlighter is a translucent stroke, so it has to go under the ink — laid
// on top it washes out every line it crosses. Paint order is the only thing
// separating the two, and it has to agree in the canvas and in the saved SVG,
// where document order is paint order.
export function paintOrder(strokes: Stroke[]): Stroke[] {
  return [
    ...strokes.filter((s) => s.opacity < 1),
    ...strokes.filter((s) => s.opacity >= 1),
  ]
}
