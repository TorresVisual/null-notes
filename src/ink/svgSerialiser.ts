import { getStroke } from 'perfect-freehand'
import type { InkData, Stroke, Shape } from './types'

function pointsToSvgPath(points: number[][]): string {
  if (points.length === 0) return ''
  const first = points[0]
  if (!first) return ''
  const d = [`M ${first[0]?.toFixed(2)} ${first[1]?.toFixed(2)}`]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    if (p) d.push(`L ${p[0]?.toFixed(2)} ${p[1]?.toFixed(2)}`)
  }
  d.push('Z')
  return d.join(' ')
}

export function strokeToPath(stroke: Stroke): string {
  const inputPoints = stroke.points.map((p) => [p.x, p.y, p.pressure])
  const outlinePoints = getStroke(inputPoints, {
    size: stroke.size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  })
  const d = pointsToSvgPath(outlinePoints)
  const raw = JSON.stringify(stroke.points)
  return `<path data-id="${stroke.id}" data-points="${encodeURIComponent(raw)}" data-color="${stroke.color}" data-size="${stroke.size}" d="${d}" fill="${stroke.color}" />`
}

export function shapeToElement(shape: Shape): string {
  const base = `data-id="${shape.id}" data-kind="${shape.kind}" data-x1="${shape.x1}" data-y1="${shape.y1}" data-x2="${shape.x2}" data-y2="${shape.y2}" data-color="${shape.color}" data-size="${shape.size}" stroke="${shape.color}" stroke-width="${shape.size}" fill="none"`
  switch (shape.kind) {
    case 'line':
      return `<line ${base} x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" />`
    case 'rect': {
      const x = Math.min(shape.x1, shape.x2)
      const y = Math.min(shape.y1, shape.y2)
      const w = Math.abs(shape.x2 - shape.x1)
      const h = Math.abs(shape.y2 - shape.y1)
      return `<rect ${base} x="${x}" y="${y}" width="${w}" height="${h}" />`
    }
    case 'circle':
    case 'arrow': {
      const cx = (shape.x1 + shape.x2) / 2
      const cy = (shape.y1 + shape.y2) / 2
      const rx = Math.abs(shape.x2 - shape.x1) / 2
      const ry = Math.abs(shape.y2 - shape.y1) / 2
      return `<ellipse ${base} cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" />`
    }
  }
}

export function inkDataToSvg(data: InkData): string {
  const paths = data.strokes.map(strokeToPath).join('\n  ')
  const elements = data.shapes.map(shapeToElement).join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" data-width="${data.width}" data-height="${data.height}" width="${data.width}" height="${data.height}" viewBox="0 0 ${data.width} ${data.height}">
  ${paths}
  ${elements}
</svg>`
}

export function svgToInkData(svg: string): InkData {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svg, 'image/svg+xml')
  const root = doc.querySelector('svg')

  const width = Number(root?.getAttribute('data-width') ?? 800)
  const height = Number(root?.getAttribute('data-height') ?? 600)

  const strokes: Stroke[] = []
  for (const el of doc.querySelectorAll('path[data-id]')) {
    const id = el.getAttribute('data-id') ?? ''
    const color = el.getAttribute('data-color') ?? '#000000'
    const size = Number(el.getAttribute('data-size') ?? 4)
    const raw = el.getAttribute('data-points') ?? '[]'
    const points = JSON.parse(decodeURIComponent(raw)) as Stroke['points']
    strokes.push({ id, points, color, size })
  }

  const shapes: Shape[] = []
  for (const selector of ['line[data-id]', 'rect[data-id]', 'ellipse[data-id]']) {
    for (const el of doc.querySelectorAll(selector)) {
      shapes.push({
        id: el.getAttribute('data-id') ?? '',
        kind: el.getAttribute('data-kind') as Shape['kind'],
        x1: Number(el.getAttribute('data-x1') ?? 0),
        y1: Number(el.getAttribute('data-y1') ?? 0),
        x2: Number(el.getAttribute('data-x2') ?? 0),
        y2: Number(el.getAttribute('data-y2') ?? 0),
        color: el.getAttribute('data-color') ?? '#000000',
        size: Number(el.getAttribute('data-size') ?? 2),
      })
    }
  }

  return { width, height, strokes, shapes }
}
