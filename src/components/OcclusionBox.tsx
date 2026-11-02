import type { OcclusionMark } from '../lib/occlusion'

interface OcclusionBoxProps {
  mark: OcclusionMark
}

// Positioned in percentages of its offset parent, so the parent must wrap the
// image tightly (`.note-image` does).
export function OcclusionBox({ mark }: OcclusionBoxProps) {
  const { x, y, w, h } = mark.rect
  return (
    <span
      className={`occlusion-box occlusion-box--${mark.mode}`}
      data-testid={`occlusion-${mark.mode}`}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
    />
  )
}
