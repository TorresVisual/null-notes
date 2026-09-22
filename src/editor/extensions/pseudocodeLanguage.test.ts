import { describe, it, expect } from 'vitest'
import { createLowlight, common } from 'lowlight'
import { pseudocodeLanguage } from './pseudocodeLanguage'

describe('pseudocodeLanguage', () => {
  const lowlight = createLowlight(common)
  lowlight.register({ pseudocode: pseudocodeLanguage })
  lowlight.registerAlias({ pseudocode: ['pseudo'] })

  it('highlights control-flow keywords', () => {
    const tree = lowlight.highlight('pseudocode', 'FOR i = 1 TO n DO\n  IF i > 0 THEN RETURN i\nENDFOR')
    const html = JSON.stringify(tree)
    expect(html).toContain('hljs-keyword')
  })

  it('is reachable via its registered alias', () => {
    expect(lowlight.registered('pseudo')).toBe(true)
  })
})
