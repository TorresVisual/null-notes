import { describe, it, expect } from 'vitest'
import { buildPageCss, formatPrintDate } from './printPreviewCss'

describe('buildPageCss', () => {
  it('includes no margin-box rules when every field is off', () => {
    const css = buildPageCss({ showPageNumber: false, showTitle: false, showDate: false, title: 'Lecture 7', date: 'August 31, 2026' })
    expect(css).not.toContain('@bottom-center')
    expect(css).not.toContain('@top-left')
    expect(css).not.toContain('@top-right')
    expect(css).toContain('@page')
  })

  it('includes a page-number counter only when showPageNumber is true', () => {
    const css = buildPageCss({ showPageNumber: true, showTitle: false, showDate: false, title: 'Lecture 7', date: 'August 31, 2026' })
    expect(css).toContain('@bottom-center')
    expect(css).toContain('counter(page)')
    expect(css).toContain('counter(pages)')
    expect(css).not.toContain('@top-left')
  })

  it('includes the title only when showTitle is true, escaped for CSS string content', () => {
    const css = buildPageCss({ showPageNumber: false, showTitle: true, showDate: false, title: 'Lecture "7"', date: 'August 31, 2026' })
    expect(css).toContain('@top-left')
    expect(css).toContain('Lecture \\"7\\"')
  })

  it('includes the date only when showDate is true', () => {
    const css = buildPageCss({ showPageNumber: false, showTitle: false, showDate: true, title: 'Lecture 7', date: 'August 31, 2026' })
    expect(css).toContain('@top-right')
    expect(css).toContain('August 31, 2026')
  })

  it('includes all three together', () => {
    const css = buildPageCss({ showPageNumber: true, showTitle: true, showDate: true, title: 'Lecture 7', date: 'August 31, 2026' })
    expect(css).toContain('@bottom-center')
    expect(css).toContain('@top-left')
    expect(css).toContain('@top-right')
  })
})

describe('formatPrintDate', () => {
  it('formats a date as a locale-readable string', () => {
    expect(formatPrintDate(new Date(2026, 7, 31))).toBe(new Date(2026, 7, 31).toLocaleDateString())
  })
})
