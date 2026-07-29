import { describe, it, expect } from 'vitest'
import { pagesToMarkdown } from './ImportButton'
import type { PdfPage } from '../pdf/types'

function page(index: number, path: string): PdfPage {
  return { index, path, width: 1700, height: 2200 }
}

describe('pagesToMarkdown', () => {
  it('renders one pdf-page fenced block per page', () => {
    const md = pagesToMarkdown([page(0, '/ws/Note.pdf/page-0.png')])
    expect(md).toBe(
      '```pdf-page\n{"src":"/ws/Note.pdf/page-0.png","width":1700,"height":2200}\n```',
    )
  })

  it('separates multiple pages with a blank line', () => {
    const md = pagesToMarkdown([
      page(0, '/ws/Note.pdf/page-0.png'),
      page(1, '/ws/Note.pdf/page-1.png'),
    ])
    expect(md.split('\n\n')).toHaveLength(2)
  })

  it('returns an empty string for no pages', () => {
    expect(pagesToMarkdown([])).toBe('')
  })
})
