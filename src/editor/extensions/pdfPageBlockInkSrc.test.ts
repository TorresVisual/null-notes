import { describe, expect, it } from 'vitest'
import { inkSrcFor } from './PdfPageBlock'

describe('inkSrcFor', () => {
  it('swaps the page image extension for .svg under the ink dir (posix)', () => {
    expect(inkSrcFor('/ws/Lecture 7.ink', '/ws/Lecture 7.pdf/page-0.png')).toBe(
      '/ws/Lecture 7.ink/page-0.svg',
    )
  })

  it('uses backslashes when the ink dir is a Windows path', () => {
    expect(inkSrcFor('C:\\ws\\Lecture 7.ink', 'C:\\ws\\Lecture 7.pdf\\page-3.png')).toBe(
      'C:\\ws\\Lecture 7.ink\\page-3.svg',
    )
  })
})
