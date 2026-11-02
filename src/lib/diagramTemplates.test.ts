import { describe, it, expect } from 'vitest'
import { DIAGRAM_TEMPLATES } from './diagramTemplates'

// Excalidraw itself can't load under vitest (open-color's JSON import), so the
// conversion is left to the app; this guards the part the table owns — that
// every connector points at boxes that exist in the same template.
describe('DIAGRAM_TEMPLATES', () => {
  it('has no duplicate titles', () => {
    const titles = DIAGRAM_TEMPLATES.map((t) => t.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  for (const template of DIAGRAM_TEMPLATES) {
    it(`${template.title} has unique ids and connectors bound to existing boxes`, () => {
      const ids = template.elements.flatMap((e) => (e.id ? [e.id] : []))
      expect(new Set(ids).size).toBe(ids.length)
      for (const e of template.elements) {
        if (!('start' in e)) continue
        expect(ids).toContain(e.start?.id)
        expect(ids).toContain(e.end?.id)
      }
    })
  }
})
