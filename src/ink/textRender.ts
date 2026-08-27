import { TEXT_LINE_HEIGHT } from './textBounds'
import type { TextItem } from './types'

// Top baseline, not the canvas default alphabetic one — it is what lets a
// text item's stored (x, y) mean "top-left corner" everywhere else it is
// used (hit-testing, dragging, the editing overlay's own CSS position)
// instead of needing a per-consumer baseline correction.
export function drawTextItem(ctx: CanvasRenderingContext2D, item: TextItem): void {
  ctx.save()
  ctx.fillStyle = item.color
  ctx.font = `${item.size}px sans-serif`
  ctx.textBaseline = 'top'
  const lineHeight = item.size * TEXT_LINE_HEIGHT
  const lines = item.text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i] ?? '', item.x, item.y + i * lineHeight)
  }
  ctx.restore()
}
