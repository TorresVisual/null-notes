import { describe, it, expect } from 'vitest'
import { strokeToPath, shapeToElement, inkDataToSvg, svgToInkData } from './svgSerialiser'
import type { Stroke, Shape, InkData } from './types'

const stroke: Stroke = {
  id: 's1',
  points: [
    { x: 10, y: 10, pressure: 0.5 },
    { x: 20, y: 20, pressure: 0.6 },
    { x: 30, y: 15, pressure: 0.4 },
  ],
  color: '#000000',
  size: 4,
  opacity: 1,
}

const shape: Shape = {
  id: 'sh1',
  kind: 'rect',
  x1: 10, y1: 10, x2: 100, y2: 80,
  color: '#ff0000',
  size: 2,
}

describe('strokeToPath', () => {
  it('returns an SVG path element string', () => {
    const result = strokeToPath(stroke)
    expect(result).toContain('<path')
    expect(result).toContain('data-id="s1"')
    expect(result).toContain('fill="#000000"')
  })
})

describe('shapeToElement', () => {
  it('returns a rect element for rect kind', () => {
    const result = shapeToElement(shape)
    expect(result).toContain('<rect')
    expect(result).toContain('data-id="sh1"')
    expect(result).toContain('stroke="#ff0000"')
  })

  it('returns a line element for line kind', () => {
    const line: Shape = { ...shape, id: 'sh2', kind: 'line' }
    expect(shapeToElement(line)).toContain('<line')
  })

  it('returns an ellipse element for circle kind', () => {
    const circle: Shape = { ...shape, id: 'sh3', kind: 'circle' }
    expect(shapeToElement(circle)).toContain('<ellipse')
  })

  it('returns a path element with an arrowhead for arrow kind', () => {
    const arrow: Shape = { ...shape, id: 'sh4', kind: 'arrow' }
    const result = shapeToElement(arrow)
    expect(result).toContain('<path')
    expect(result).toContain('data-kind="arrow"')
    expect(result).toContain('M 10 10 L 100 80')
  })
})

describe('inkDataToSvg / svgToInkData roundtrip', () => {
  it('round-trips stroke and shape data', () => {
    const data: InkData = { width: 800, height: 600, strokes: [stroke], shapes: [shape] }
    const svg = inkDataToSvg(data)
    expect(svg).toContain('<svg')
    expect(svg).toContain('data-width="800"')

    const restored = svgToInkData(svg)
    expect(restored.strokes).toHaveLength(1)
    expect(restored.strokes[0]?.id).toBe('s1')
    expect(restored.shapes).toHaveLength(1)
    expect(restored.shapes[0]?.id).toBe('sh1')
  })

  it('round-trips a highlighter opacity', () => {
    const highlighter: Stroke = { ...stroke, id: 's2', opacity: 0.3 }
    const data: InkData = { width: 800, height: 600, strokes: [highlighter], shapes: [] }

    const restored = svgToInkData(inkDataToSvg(data))
    expect(restored.strokes[0]?.opacity).toBe(0.3)
  })

  it('reads a stroke written before opacity existed as fully opaque', () => {
    const legacy = `<svg xmlns="http://www.w3.org/2000/svg" data-width="800" data-height="600">
      <path data-id="old" data-points="${encodeURIComponent('[]')}" data-color="#000000" data-size="4" d="M 0 0" fill="#000000" />
    </svg>`
    expect(svgToInkData(legacy).strokes[0]?.opacity).toBe(1)
  })

  it('writes highlighters before ink so they sit underneath', () => {
    const highlighter: Stroke = { ...stroke, id: 'hl', opacity: 0.3 }
    const data: InkData = { width: 800, height: 600, strokes: [stroke, highlighter], shapes: [] }

    const svg = inkDataToSvg(data)
    expect(svg.indexOf('data-id="hl"')).toBeLessThan(svg.indexOf('data-id="s1"'))
  })

  it('round-trips a stroke alongside an arrow without cross-contamination', () => {
    const arrow: Shape = { ...shape, id: 'sh4', kind: 'arrow' }
    const data: InkData = { width: 800, height: 600, strokes: [stroke], shapes: [arrow] }
    const svg = inkDataToSvg(data)

    const restored = svgToInkData(svg)
    expect(restored.strokes).toHaveLength(1)
    expect(restored.strokes[0]?.id).toBe('s1')
    expect(restored.shapes).toHaveLength(1)
    expect(restored.shapes[0]?.id).toBe('sh4')
    expect(restored.shapes[0]?.kind).toBe('arrow')
  })
})
