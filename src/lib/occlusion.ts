export interface OcclusionRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export type OcclusionMode = 'occlude' | 'reveal'

export interface OcclusionMark {
  mode: OcclusionMode
  rect: OcclusionRect
}

const MIN_SIDE = 0.01
const PRECISION = 10000
const TITLE_PATTERN = /^(occlude|reveal)=(\d*\.?\d+),(\d*\.?\d+),(\d*\.?\d+),(\d*\.?\d+)$/

const round = (n: number) => Math.round(n * PRECISION) / PRECISION
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

// The image title is the whole storage format: an `occlude=` line is the card
// front (region hidden), the `reveal=` twin is the card back (region
// outlined). The Rust side (`parse_occlusion_line`, notes.rs) applies the same
// bounds, so a rectangle rejected here is rejected there too.
export function formatOcclusionTitle(mode: OcclusionMode, { x, y, w, h }: OcclusionRect): string {
  return `${mode}=${x},${y},${w},${h}`
}

export function parseOcclusionTitle(title: string | null | undefined): OcclusionMark | null {
  const match = title ? TITLE_PATTERN.exec(title) : null
  if (!match) return null
  const [x, y, w, h] = match.slice(2).map(Number) as [number, number, number, number]
  const within = (start: number, len: number) => len > 0 && start + len <= 1 + 1e-6
  if (!within(x, w) || !within(y, h)) return null
  return { mode: match[1] as OcclusionMode, rect: { x, y, w, h } }
}

// Normalised to the image so a region survives the image being shown at any
// size. Null for a click or a sliver too small to be a deliberate region.
export function rectFromPoints(a: Point, b: Point): OcclusionRect | null {
  const left = round(clamp01(Math.min(a.x, b.x)))
  const top = round(clamp01(Math.min(a.y, b.y)))
  const right = round(clamp01(Math.max(a.x, b.x)))
  const bottom = round(clamp01(Math.max(a.y, b.y)))
  const w = round(right - left)
  const h = round(bottom - top)
  return w < MIN_SIDE || h < MIN_SIDE ? null : { x: left, y: top, w, h }
}
