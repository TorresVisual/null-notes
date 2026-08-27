import { describe, it, expect } from 'vitest'
import mermaid from 'mermaid'
import { MERMAID_TEMPLATES } from './mermaidTemplates'

mermaid.initialize({ startOnLoad: false, theme: 'default' })

// A standing regression guard for the whole table, not just whichever
// template was last hand-checked — the same posture `mathSnippets.test.ts`
// takes for every LaTeX snippet through KaTeX. Full layout (`mermaid.render`)
// needs `getBBox`, which jsdom doesn't implement, so this validates grammar
// via `mermaid.parse` — real visual rendering is left to the app itself, the
// same trade-off recorded throughout the ink/pointer features.
describe('every Mermaid template parses without error', () => {
  for (const template of MERMAID_TEMPLATES) {
    it(`${template.title}`, async () => {
      await expect(mermaid.parse(template.code)).resolves.toBeTruthy()
    })
  }
})

describe('MERMAID_TEMPLATES', () => {
  it('has no duplicate titles', () => {
    const titles = MERMAID_TEMPLATES.map((t) => t.title)
    expect(new Set(titles).size).toBe(titles.length)
  })
})
