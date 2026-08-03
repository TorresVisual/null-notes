import { describe, it, expect } from 'vitest'
import { pagesToMarkdown, substituteImagePlaceholders } from './ImportButton'
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

describe('substituteImagePlaceholders', () => {
  it('replaces each placeholder with its real path', () => {
    const markdown = 'before\n\n![](pdf-image://0)\n\nafter'
    const result = substituteImagePlaceholders(markdown, [
      { placeholder: 'pdf-image://0', src: 'Note.assets/image-1.png' },
    ])
    expect(result).toBe('before\n\n![](Note.assets/image-1.png)\n\nafter')
  })

  it('replaces multiple placeholders independently', () => {
    const markdown = '![](pdf-image://0)\n\n![](pdf-image://1)'
    const result = substituteImagePlaceholders(markdown, [
      { placeholder: 'pdf-image://0', src: 'a.png' },
      { placeholder: 'pdf-image://1', src: 'b.png' },
    ])
    expect(result).toBe('![](a.png)\n\n![](b.png)')
  })

  it('is a no-op when there are no images', () => {
    expect(substituteImagePlaceholders('plain text', [])).toBe('plain text')
  })
})
