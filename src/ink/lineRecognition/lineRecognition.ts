import { fitLine, perpendicularDistance, projectOnto } from './lineFitting'
import { pathLength, preprocess } from './preprocess'
import type { LineRecognitionConfig, RecognizedLine, XY } from './types'

// Experimental starting values; tune here, nothing else hard-codes them.
export const DEFAULT_LINE_CONFIG: LineRecognitionConfig = {
  enterRms: 0.025,
  exitRms: 0.04,
  maxP95: 0.05,
  minChordPathRatio: 0.97,
  minLength: 24,
  minSamples: 3,
  minStep: 0.5,
  resampleCount: 64,
}

/**
 * Is this stroke (so far) a straight line? `showing` is whether a line is
 * already on screen: it widens the RMS limit from enter to exit so a stroke
 * hovering near the threshold doesn't flicker between line and freehand.
 * Pure: the stroke is never modified, and the caller owns what to draw.
 */
export function recognizeLine(
  stroke: readonly XY[],
  showing = false,
  config: LineRecognitionConfig = DEFAULT_LINE_CONFIG,
): RecognizedLine | null {
  const first = stroke[0]
  const last = stroke[stroke.length - 1]
  if (!first || !last) return null
  const chord = Math.hypot(last.x - first.x, last.y - first.y)
  if (chord < config.minLength) return null

  const points = preprocess(stroke, config)
  if (points.length < config.minSamples) return null

  const path = pathLength(points)
  const chordPathRatio = path === 0 ? 0 : chord / path
  if (chordPathRatio < config.minChordPathRatio) return null

  const fit = fitLine(points)
  const deviations = points.map((p) => perpendicularDistance(fit, p) / chord).sort((a, b) => a - b)
  const rms = Math.sqrt(deviations.reduce((sum, d) => sum + d * d, 0) / deviations.length)
  const p95 = deviations[Math.ceil(deviations.length * 0.95) - 1]!
  if (rms > (showing ? config.exitRms : config.enterRms) || p95 > config.maxP95) return null

  const start = projectOnto(fit, first)
  const end = projectOnto(fit, last)
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y, metrics: { rms, p95, chordPathRatio } }
}
