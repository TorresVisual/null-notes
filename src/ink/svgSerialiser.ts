import { getStroke } from 'perfect-freehand'
import { paintOrder } from './paintOrder'
import { GROW_MARGIN, inkBounds } from './growCanvas'
import { TEXT_LINE_HEIGHT } from './textBounds'
import type { InkData, Stroke, Shape, TextItem } from './types'

function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

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
  const thinning = stroke.thinning ?? 0.5
  const inputPoints = stroke.points.map((p) => [p.x, p.y, p.pressure])
  const outlinePoints = getStroke(inputPoints, {
    size: stroke.size,
    thinning,
    smoothing: 0.5,
    streamline: 0.5,
  })
  const d = pointsToSvgPath(outlinePoints)
  const raw = JSON.stringify(stroke.points)
  return `<path data-id="${stroke.id}" data-points="${encodeURIComponent(raw)}" data-color="${stroke.color}" data-size="${stroke.size}" data-opacity="${stroke.opacity}" data-thinning="${thinning}" d="${d}" fill="${stroke.color}" fill-opacity="${stroke.opacity}" />`
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
    case 'circle': {
      const cx = (shape.x1 + shape.x2) / 2
      const cy = (shape.y1 + shape.y2) / 2
      const rx = Math.abs(shape.x2 - shape.x1) / 2
      const ry = Math.abs(shape.y2 - shape.y1) / 2
      return `<ellipse ${base} cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" />`
    }
    case 'arrow': {
      const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1)
      const dist = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1)
      const headLength = Math.min(18, dist * 0.4)
      const headAngle = 0.436
      const ax = shape.x2 - headLength * Math.cos(angle - headAngle)
      const ay = shape.y2 - headLength * Math.sin(angle - headAngle)
      const bx = shape.x2 - headLength * Math.cos(angle + headAngle)
      const by = shape.y2 - headLength * Math.sin(angle + headAngle)
      const d = `M ${shape.x1} ${shape.y1} L ${shape.x2} ${shape.y2} M ${shape.x2} ${shape.y2} L ${ax.toFixed(2)} ${ay.toFixed(2)} M ${shape.x2} ${shape.y2} L ${bx.toFixed(2)} ${by.toFixed(2)}`
      return `<path ${base} d="${d}" />`
    }
  }
}

// `data-text` (URI-encoded, like a stroke's own `data-points`) is the source
// of truth read back on load; the `<tspan>` lines are a best-effort visual
// approximation for anyone who opens the raw SVG outside the app — the app
// itself always redraws from the parsed `TextItem`, never from these tspans.
export function textItemToElement(item: TextItem): string {
  const lineHeight = item.size * TEXT_LINE_HEIGHT
  const lines = item.text.split('\n')
  const tspans = lines
    .map((line, i) => `<tspan x="${item.x}" y="${item.y + item.size + i * lineHeight}">${escapeXmlText(line)}</tspan>`)
    .join('')
  const raw = encodeURIComponent(item.text)
  return `<text data-id="${item.id}" data-x="${item.x}" data-y="${item.y}" data-color="${item.color}" data-size="${item.size}" data-text="${raw}" fill="${item.color}" font-size="${item.size}" font-family="sans-serif">${tspans}</text>`
}

export function inkDataToSvg(data: InkData): string {
  const paths = paintOrder(data.strokes).map(strokeToPath).join('\n  ')
  const elements = data.shapes.map(shapeToElement).join('\n  ')
  const texts = data.texts.map(textItemToElement).join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" data-origin-x="${data.originX}" data-origin-y="${data.originY}" data-width="${data.width}" data-height="${data.height}" width="${data.width}" height="${data.height}" viewBox="${data.originX} ${data.originY} ${data.width} ${data.height}">
  ${paths}
  ${elements}
  ${texts}
</svg>`
}

// Older builds rewrite the header as `0 0 w h` but keep every stroke, so a file
// that grew leftward and was then saved by one comes back with ink outside its
// page. Only ink actually outside the origin moves it; merely being near the
// edge must not, or every existing note would shift on first open. The right
// and bottom edges stay where they were.
function coverContent(data: InkData): InkData {
  const { minX, minY } = inkBounds(data)
  let { originX, originY, width, height } = data
  if (minX < originX) {
    const next = minX - GROW_MARGIN
    width += originX - next
    originX = next
  }
  if (minY < originY) {
    const next = minY - GROW_MARGIN
    height += originY - next
    originY = next
  }
  return { ...data, originX, originY, width, height }
}

export function svgToInkData(svg: string): InkData {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svg, 'image/svg+xml')
  const root = doc.querySelector('svg')

  const originX = Number(root?.getAttribute('data-origin-x') ?? 0)
  const originY = Number(root?.getAttribute('data-origin-y') ?? 0)
  const width = Number(root?.getAttribute('data-width') ?? 800)
  const height = Number(root?.getAttribute('data-height') ?? 600)

  const strokes: Stroke[] = []
  for (const el of doc.querySelectorAll('path[data-id]:not([data-kind])')) {
    const id = el.getAttribute('data-id') ?? ''
    const color = el.getAttribute('data-color') ?? '#000000'
    const size = Number(el.getAttribute('data-size') ?? 4)
    const opacity = Number(el.getAttribute('data-opacity') ?? 1)
    // Absent, not defaulted to 0.5 here: a stroke drawn before P13-2 has no
    // `data-thinning` at all, and leaving it `undefined` (rather than
    // baking in today's default) is what lets that default change later
    // without silently rewriting every pre-existing stroke's own value.
    const thinningAttr = el.getAttribute('data-thinning')
    const thinning = thinningAttr === null ? undefined : Number(thinningAttr)
    const raw = el.getAttribute('data-points') ?? '[]'
    const points = JSON.parse(decodeURIComponent(raw)) as Stroke['points']
    strokes.push({ id, points, color, size, opacity, thinning })
  }

  const shapes: Shape[] = []
  for (const selector of ['line[data-id]', 'rect[data-id]', 'ellipse[data-id]', 'path[data-kind="arrow"]']) {
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

  const texts: TextItem[] = []
  for (const el of doc.querySelectorAll('text[data-id]')) {
    const id = el.getAttribute('data-id') ?? ''
    const x = Number(el.getAttribute('data-x') ?? 0)
    const y = Number(el.getAttribute('data-y') ?? 0)
    const color = el.getAttribute('data-color') ?? '#000000'
    const size = Number(el.getAttribute('data-size') ?? 18)
    const raw = el.getAttribute('data-text')
    const text = raw === null ? '' : decodeURIComponent(raw)
    texts.push({ id, x, y, color, size, text })
  }

  return coverContent({ originX, originY, width, height, strokes, shapes, texts })
}
