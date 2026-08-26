import { describe, it, expect } from 'vitest'
import { renderMath } from './mathRender'

describe('renderMath', () => {
  it('renders valid latex with no error', () => {
    const result = renderMath('x^2 + y^2', false)
    expect(result.error).toBeNull()
    expect(result.errorPosition).toBeNull()
    expect(result.html).toContain('katex')
  })

  it('reports the offending span for an undefined control sequence', () => {
    const result = renderMath('\\alpa', false)
    expect(result.error).not.toBeNull()
    expect(result.errorPosition).toBe(0)
    expect(result.errorLength).toBe(5)
  })

  it('reports a zero-length span at the end of input for an unclosed group', () => {
    const result = renderMath('x_{', false)
    expect(result.error).not.toBeNull()
    expect(result.errorPosition).toBe(3)
    expect(result.errorLength).toBe(0)
  })

  it('still returns renderable fallback html on error', () => {
    const result = renderMath('\\zzz', true)
    expect(result.error).not.toBeNull()
    expect(result.html).toContain('#cc0000')
  })
})
