import type { StrokeOptions } from 'perfect-freehand'
import type { Stroke } from './types'

export const DEFAULT_THINNING = 0.5

export type StrokeKind = 'ink' | 'pencil' | 'highlighter'

// Derived, not stored: the sidecar format has no kind field and gaining one
// would mean a format change. These two fields are what the presets already
// differ in (`pens.ts`), so they are the kind.
export function strokeKind({ opacity, thinning }: Pick<Stroke, 'opacity' | 'thinning'>): StrokeKind {
  if (opacity < 1) return 'highlighter'
  if ((thinning ?? DEFAULT_THINNING) <= 0.2) return 'pencil'
  return 'ink'
}

// Starting values, tuned by eye in the running app and deliberately not
// unit-tested. Lower is crisper; the pencil follows the hand, the highlighter
// irons the wobble out of a wide wash.
const FEEL: Record<StrokeKind, { smoothing: number; streamline: number }> = {
  ink: { smoothing: 0.5, streamline: 0.5 },
  pencil: { smoothing: 0.3, streamline: 0.3 },
  highlighter: { smoothing: 0.7, streamline: 0.7 },
}

export function strokeOptions(stroke: Pick<Stroke, 'size' | 'opacity' | 'thinning'>): StrokeOptions {
  return {
    size: stroke.size,
    thinning: stroke.thinning ?? DEFAULT_THINNING,
    simulatePressure: false,
    ...FEEL[strokeKind(stroke)],
  }
}
