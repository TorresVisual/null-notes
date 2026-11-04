export const MIN_ZOOM_PCT = 50
export const MAX_ZOOM_PCT = 200

export function clampZoom(pct: number): number {
  return Math.min(MAX_ZOOM_PCT, Math.max(MIN_ZOOM_PCT, pct))
}
