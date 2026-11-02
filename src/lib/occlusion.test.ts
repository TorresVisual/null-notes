import { describe, it, expect } from 'vitest'
import { formatOcclusionTitle, parseOcclusionTitle, rectFromPoints } from './occlusion'

describe('occlusion title', () => {
  it('round-trips both modes', () => {
    const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }
    expect(formatOcclusionTitle('occlude', rect)).toBe('occlude=0.1,0.2,0.3,0.1')
    expect(parseOcclusionTitle('occlude=0.1,0.2,0.3,0.1')).toEqual({ mode: 'occlude', rect })
    expect(parseOcclusionTitle(formatOcclusionTitle('reveal', rect))).toEqual({ mode: 'reveal', rect })
  })

  it.each([
    null,
    undefined,
    '',
    'a plain title',
    'occlude=0.1,0.2,0.3',
    'occlude=0.8,0.1,0.4,0.1',
    'occlude=0.1,0.1,0,0.1',
    'occlude=-0.1,0.1,0.2,0.1',
    'hide=0.1,0.1,0.2,0.1',
  ])('rejects %s', (title) => {
    expect(parseOcclusionTitle(title)).toBeNull()
  })
})

describe('rectFromPoints', () => {
  it('orders the corners whichever way the drag went', () => {
    expect(rectFromPoints({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, w: 0.3, h: 0.5 })
  })

  it('clamps a drag that leaves the image', () => {
    expect(rectFromPoints({ x: -0.2, y: 0.5 }, { x: 1.4, y: 0.9 })).toEqual({ x: 0, y: 0.5, w: 1, h: 0.4 })
  })

  it('drops a click and a sliver', () => {
    expect(rectFromPoints({ x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 })).toBeNull()
    expect(rectFromPoints({ x: 0.3, y: 0.3 }, { x: 0.305, y: 0.6 })).toBeNull()
  })

  it('never produces a rectangle the parser rejects', () => {
    const rect = rectFromPoints({ x: 0.123456, y: 0.333333 }, { x: 0.987654, y: 0.999999 })
    expect(rect).not.toBeNull()
    expect(parseOcclusionTitle(formatOcclusionTitle('occlude', rect!))).not.toBeNull()
  })
})
