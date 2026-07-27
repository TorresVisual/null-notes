import { describe, it, expect } from 'vitest'
import { isCanvasNote, canvasSrcFrom, canvasNoteBody } from './canvasNote'

const canvas = '# Lecture 07\n\n```ink-page\n{"src":"Lecture 07.ink/page.svg"}\n```\n'

describe('canvasNote', () => {
  it('recognises a canvas note and reads its sidecar path', () => {
    expect(isCanvasNote(canvas)).toBe(true)
    expect(canvasSrcFrom(canvas)).toBe('Lecture 07.ink/page.svg')
  })

  it('leaves ordinary notes alone', () => {
    expect(isCanvasNote('# Notes\n\nSome text about #graphs.')).toBe(false)
  })

  // An inline ink block is a different fence; mistaking one for a page would
  // replace a typed note with a full-screen canvas.
  it('does not mistake an inline ink block for a canvas note', () => {
    const inline = '# Note\n\n```ink\n{"src":"n.ink/sketch-1.svg","width":700,"height":900}\n```\n'
    expect(isCanvasNote(inline)).toBe(false)
  })

  it('treats a malformed or empty fence as not a canvas note', () => {
    expect(isCanvasNote('```ink-page\nnot json\n```')).toBe(false)
    expect(isCanvasNote('```ink-page\n{}\n```')).toBe(false)
    expect(isCanvasNote('```ink-page\n{"src":""}\n```')).toBe(false)
  })

  it('round-trips a body it authored', () => {
    const body = canvasNoteBody('Lecture 07', 'Lecture 07.ink/page.svg')
    expect(canvasSrcFrom(body)).toBe('Lecture 07.ink/page.svg')
  })

  // The heading is what keeps title_from_content, search and [[links]] working.
  it('keeps the title as a real heading', () => {
    expect(canvasNoteBody('Lecture 07', 'x.svg').startsWith('# Lecture 07\n')).toBe(true)
  })

  it('survives Windows paths, which carry backslashes into the JSON', () => {
    const src = 'D:\\notes\\Lecture 07.ink\\page.svg'
    expect(canvasSrcFrom(canvasNoteBody('Lecture 07', src))).toBe(src)
  })
})
