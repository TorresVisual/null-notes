import { describe, expect, it } from 'vitest'
import { sanitizeNoteHtml } from './sanitizeHtml'

describe('sanitizeNoteHtml', () => {
  it('strips iframe blocks, including srcdoc script payloads', () => {
    const out = sanitizeNoteHtml('<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>')
    expect(out).not.toContain('iframe')
  })

  it('strips event handler attributes from svg', () => {
    const out = sanitizeNoteHtml('<svg><animate onbegin="alert(1)" attributeName="x"/></svg>')
    expect(out).not.toContain('onbegin')
  })

  it('strips object/embed tags', () => {
    expect(sanitizeNoteHtml('<object data="javascript:alert(1)"></object>')).not.toContain('object')
    expect(sanitizeNoteHtml('<embed src="x">')).not.toContain('embed')
  })

  it('preserves benign svg figures and semantic sections', () => {
    const svg = '<svg width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>'
    expect(sanitizeNoteHtml(svg)).toContain('<circle')
    expect(sanitizeNoteHtml('<section><p>hello</p></section>')).toContain('<p>hello</p>')
  })
})
