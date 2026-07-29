import { describe, it, expect } from 'vitest'
import { titleFromPdfPath } from './usePdfImport'

describe('titleFromPdfPath', () => {
  it('strips the .pdf extension from a Windows path', () => {
    expect(titleFromPdfPath('D:\\Downloads\\Lecture 7.pdf')).toBe('Lecture 7')
  })

  it('strips the .pdf extension from a posix path', () => {
    expect(titleFromPdfPath('/home/me/Downloads/sheet.pdf')).toBe('sheet')
  })

  it('is case-insensitive about the extension', () => {
    expect(titleFromPdfPath('/tmp/Notes.PDF')).toBe('Notes')
  })
})
