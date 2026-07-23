export interface PreviewShape {
  kind: 'line' | 'circle' | 'rect' | 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  size: number
}

export function drawShapePreview(ctx: CanvasRenderingContext2D, shape: PreviewShape): void {
  ctx.save()
  ctx.strokeStyle = shape.color
  ctx.lineWidth = shape.size
  ctx.beginPath()

  switch (shape.kind) {
    case 'line':
      ctx.moveTo(shape.x1, shape.y1)
      ctx.lineTo(shape.x2, shape.y2)
      break
    case 'rect': {
      const x = Math.min(shape.x1, shape.x2)
      const y = Math.min(shape.y1, shape.y2)
      const w = Math.abs(shape.x2 - shape.x1)
      const h = Math.abs(shape.y2 - shape.y1)
      ctx.rect(x, y, w, h)
      break
    }
    case 'circle': {
      const cx = (shape.x1 + shape.x2) / 2
      const cy = (shape.y1 + shape.y2) / 2
      const rx = Math.abs(shape.x2 - shape.x1) / 2
      const ry = Math.abs(shape.y2 - shape.y1) / 2
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      break
    }
    case 'arrow': {
      const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1)
      const dist = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1)
      const headLength = Math.min(18, dist * 0.4)
      const headAngle = 0.436
      ctx.moveTo(shape.x1, shape.y1)
      ctx.lineTo(shape.x2, shape.y2)
      ctx.moveTo(shape.x2, shape.y2)
      ctx.lineTo(
        shape.x2 - headLength * Math.cos(angle - headAngle),
        shape.y2 - headLength * Math.sin(angle - headAngle),
      )
      ctx.moveTo(shape.x2, shape.y2)
      ctx.lineTo(
        shape.x2 - headLength * Math.cos(angle + headAngle),
        shape.y2 - headLength * Math.sin(angle + headAngle),
      )
      break
    }
  }

  ctx.stroke()
  ctx.restore()
}
