import { describe, it, expect } from 'vitest'
import { strokeToPath, shapeToElement, textItemToElement, inkDataToSvg, svgToInkData } from './svgSerialiser'
import type { Stroke, Shape, TextItem, InkData } from './types'
import { sanitizeNoteHtml } from '../lib/sanitizeHtml'
import { GROW_MARGIN } from './growCanvas'

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

const textItem: TextItem = {
  id: 'txt1',
  x: 40,
  y: 60,
  text: 'hello',
  color: '#00ff00',
  size: 18,
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

describe('textItemToElement', () => {
  it('returns a text element carrying the raw text as a data attribute', () => {
    const result = textItemToElement(textItem)
    expect(result).toContain('<text')
    expect(result).toContain('data-id="txt1"')
    expect(result).toContain(`data-text="${encodeURIComponent('hello')}"`)
    expect(result).toContain('fill="#00ff00"')
  })

  it('emits one tspan per line, stepped down by the line height', () => {
    const result = textItemToElement({ ...textItem, text: 'first\nsecond' })
    expect(result).toContain('<tspan x="40" y="78">first</tspan>')
    expect(result).toContain(`<tspan x="40" y="${60 + 18 + 18 * 1.2}">second</tspan>`)
  })

  it('escapes XML-significant characters in the visual tspans', () => {
    const result = textItemToElement({ ...textItem, text: 'a < b & c > d' })
    expect(result).toContain('a &lt; b &amp; c &gt; d')
  })
})

describe('inkDataToSvg / svgToInkData roundtrip', () => {
  it('round-trips stroke and shape data', () => {
    const data: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [stroke], shapes: [shape], texts: [] }
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
    const data: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [highlighter], shapes: [], texts: [] }

    const restored = svgToInkData(inkDataToSvg(data))
    expect(restored.strokes[0]?.opacity).toBe(0.3)
  })

  it('reads a stroke written before opacity existed as fully opaque', () => {
    const legacy = `<svg xmlns="http://www.w3.org/2000/svg" data-width="800" data-height="600">
      <path data-id="old" data-points="${encodeURIComponent('[]')}" data-color="#000000" data-size="4" d="M 0 0" fill="#000000" />
    </svg>`
    expect(svgToInkData(legacy).strokes[0]?.opacity).toBe(1)
  })

  // P13-2: thinning is written for every new stroke, but a stroke drawn
  // before it existed has no `data-thinning` at all — left `undefined`
  // (not defaulted here) so a later change to the render-time default
  // doesn't silently rewrite what an old stroke's own value means.
  it('reads a stroke written before thinning existed as undefined, not defaulted', () => {
    const legacy = `<svg xmlns="http://www.w3.org/2000/svg" data-width="800" data-height="600">
      <path data-id="old" data-points="${encodeURIComponent('[]')}" data-color="#000000" data-size="4" data-opacity="1" d="M 0 0" fill="#000000" />
    </svg>`
    expect(svgToInkData(legacy).strokes[0]?.thinning).toBeUndefined()
  })

  it('round-trips a pencil stroke\'s low thinning value', () => {
    const pencilStroke: Stroke = { ...stroke, id: 'pencil1', thinning: 0.1 }
    const data: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [pencilStroke], shapes: [], texts: [] }

    const svg = inkDataToSvg(data)
    expect(svg).toContain('data-thinning="0.1"')
    expect(svgToInkData(svg).strokes[0]?.thinning).toBe(0.1)
  })

  it('writes highlighters before ink so they sit underneath', () => {
    const highlighter: Stroke = { ...stroke, id: 'hl', opacity: 0.3 }
    const data: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [stroke, highlighter], shapes: [], texts: [] }

    const svg = inkDataToSvg(data)
    expect(svg.indexOf('data-id="hl"')).toBeLessThan(svg.indexOf('data-id="s1"'))
  })

  it('round-trips a stroke alongside an arrow without cross-contamination', () => {
    const arrow: Shape = { ...shape, id: 'sh4', kind: 'arrow' }
    const data: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [stroke], shapes: [arrow], texts: [] }
    const svg = inkDataToSvg(data)

    const restored = svgToInkData(svg)
    expect(restored.strokes).toHaveLength(1)
    expect(restored.strokes[0]?.id).toBe('s1')
    expect(restored.shapes).toHaveLength(1)
    expect(restored.shapes[0]?.id).toBe('sh4')
    expect(restored.shapes[0]?.kind).toBe('arrow')
  })

  it('round-trips a text item', () => {
    const data: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [], shapes: [], texts: [textItem] }
    const restored = svgToInkData(inkDataToSvg(data))
    expect(restored.texts).toHaveLength(1)
    expect(restored.texts[0]).toEqual(textItem)
  })

  it('round-trips a multi-line text item byte-identical, including the newline', () => {
    const multiline: TextItem = { ...textItem, id: 'txt2', text: 'first\nsecond' }
    const data: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [], shapes: [], texts: [multiline] }
    const restored = svgToInkData(inkDataToSvg(data))
    expect(restored.texts[0]?.text).toBe('first\nsecond')
  })

  it('reads a note with no text items at all as an empty array, not undefined', () => {
    const legacy = `<svg xmlns="http://www.w3.org/2000/svg" data-width="800" data-height="600"></svg>`
    expect(svgToInkData(legacy).texts).toEqual([])
  })
})

describe('page origin', () => {
  const blank: InkData = { originX: 0, originY: 0, width: 800, height: 600, strokes: [], shapes: [], texts: [] }

  it('writes the origin into viewBox and data attributes', () => {
    const svg = inkDataToSvg({ ...blank, originX: -400, originY: -800, width: 1200, height: 1400 })
    expect(svg).toContain('viewBox="-400 -800 1200 1400"')
    expect(svg).toContain('data-origin-x="-400"')
    expect(svg).toContain('data-origin-y="-800"')
  })

  it('round-trips a negative origin', () => {
    const data = { ...blank, originX: -400, originY: -800, width: 1200, height: 1400 }
    const restored = svgToInkData(inkDataToSvg(data))
    expect(restored).toMatchObject({ originX: -400, originY: -800, width: 1200, height: 1400 })
  })

  it('reads a file written before origins existed as origin 0, 0', () => {
    const legacy = `<svg xmlns="http://www.w3.org/2000/svg" data-width="800" data-height="600"></svg>`
    expect(svgToInkData(legacy)).toMatchObject({ originX: 0, originY: 0, width: 800, height: 600 })
  })

  // Review Focus 1: the margin rule must not move files whose ink merely sits
  // near the edge — only ink that lies outside the origin widens it.
  it('leaves a legacy file with ink near the top-left corner exactly as it was', () => {
    const near = inkDataToSvg({ ...blank, strokes: [{ ...stroke, points: [{ x: 10, y: 10, pressure: 0.5 }] }] })
    expect(svgToInkData(near)).toMatchObject({ originX: 0, originY: 0, width: 800, height: 600 })
  })

  it('widens the origin to cover ink outside it, keeping the right and bottom edges fixed', () => {
    const outside = inkDataToSvg({
      ...blank,
      strokes: [{ ...stroke, points: [{ x: -300, y: -50, pressure: 0.5 }, { x: 20, y: 20, pressure: 0.5 }] }],
    })
    const restored = svgToInkData(outside)
    expect(restored.originX).toBe(-300 - GROW_MARGIN)
    expect(restored.originY).toBe(-50 - GROW_MARGIN)
    expect(restored.originX + restored.width).toBe(800)
    expect(restored.originY + restored.height).toBe(600)
  })

  it('is stable: widening a widened file changes nothing', () => {
    const outside = inkDataToSvg({
      ...blank,
      strokes: [{ ...stroke, points: [{ x: -300, y: 20, pressure: 0.5 }, { x: 20, y: 20, pressure: 0.5 }] }],
    })
    const once = svgToInkData(outside)
    expect(svgToInkData(inkDataToSvg(once))).toMatchObject({
      originX: once.originX, originY: once.originY, width: once.width, height: once.height,
    })
  })

  it('survives the preview sanitiser, so InkPreview needs no change', () => {
    const svg = inkDataToSvg({ ...blank, originX: -400, width: 1200 })
    expect(sanitizeNoteHtml(svg)).toContain('viewBox="-400 0 1200 600"')
  })
})
