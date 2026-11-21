import type { LineRecognitionConfig, XY } from './types'

function distance(a: XY, b: XY): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function pathLength(points: readonly XY[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!)
  return total
}

// Drops duplicates and moves below `minStep`. The true last sample always
// ends the result, so the stroke's real end is never trimmed away.
export function dropInsignificant(points: readonly XY[], minStep: number): XY[] {
  const kept: XY[] = []
  for (const p of points) {
    const prev = kept.at(-1)
    if (!prev || distance(prev, p) >= minStep) kept.push({ x: p.x, y: p.y })
  }
  const last = points.at(-1)
  if (last && kept.length > 1) kept[kept.length - 1] = { x: last.x, y: last.y }
  return kept
}

// Evenly spaced along the path, so a line drawn slowly (dense) and quickly
// (sparse) is judged on the same footing.
export function resample(points: readonly XY[], count: number): XY[] {
  const total = pathLength(points)
  if (points.length < 2 || total === 0) return points.map((p) => ({ ...p }))
  const out: XY[] = [{ ...points[0]! }]
  let segment = 0
  let walked = 0
  for (let i = 1; i < count - 1; i++) {
    const target = (total * i) / (count - 1)
    let length = distance(points[segment]!, points[segment + 1]!)
    while (walked + length < target && segment < points.length - 2) {
      walked += length
      segment++
      length = distance(points[segment]!, points[segment + 1]!)
    }
    const a = points[segment]!
    const b = points[segment + 1]!
    const t = length === 0 ? 0 : (target - walked) / length
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  out.push({ ...points[points.length - 1]! })
  return out
}

export function preprocess(points: readonly XY[], config: LineRecognitionConfig): XY[] {
  const significant = dropInsignificant(points, config.minStep)
  if (significant.length < config.minSamples) return significant
  return resample(significant, config.resampleCount)
}
