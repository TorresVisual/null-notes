import { describe, it, expect } from 'vitest'
import { canvasNoteBody } from './canvasNote'

describe('canvasNoteBody', () => {
  // The heading is what keeps title_from_content, search and [[links]] working.
  it('opens with a real heading', () => {
    expect(canvasNoteBody('Lecture 07', 'x.svg', 900, 1200).startsWith('# Lecture 07\n')).toBe(true)
  })

  it('writes an ink block the editor already understands', () => {
    const body = canvasNoteBody('Lecture 07', 'Lecture 07.ink/page.svg', 900, 1200)
    expect(body).toContain('```ink\n{"src":"Lecture 07.ink/page.svg","width":900,"height":1200}\n```')
  })

  // Windows paths carry backslashes, which have to survive JSON encoding.
  it('survives Windows paths', () => {
    const src = 'D:\\notes\\Lecture 07.ink\\page.svg'
    const body = canvasNoteBody('Lecture 07', src, 900, 1200)
    const fence = body.match(/```ink\n([\s\S]*?)\n```/)?.[1] ?? ''
    expect((JSON.parse(fence) as { src: string }).src).toBe(src)
  })

  // Leaves somewhere to type once the drawing is done.
  it('leaves room below the canvas', () => {
    expect(canvasNoteBody('T', 'x.svg', 900, 1200).endsWith('```\n\n')).toBe(true)
  })
})
