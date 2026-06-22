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
})
