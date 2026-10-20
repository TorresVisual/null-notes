import type { Point } from './types'

// The result is for one frame's paint only. Returning a copy is the whole
// contract: the live buffer is what gets committed, and a predicted point that
// reached it would be saved as ink the pen never drew.
export function mergePredicted(live: Point[], predicted: Point[]): Point[] {
  return predicted.length === 0 ? live : [...live, ...predicted]
}
