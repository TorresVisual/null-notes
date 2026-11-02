import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './extensions/index'
import { insertOcclusionCards } from './occlusionCards'
import { parseOcclusionTitle } from '../lib/occlusion'

let editor: Editor | null = null

function mount(content: string): Editor {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return editor
}

function markdownOf(e: Editor): string {
  const storage = e.storage as unknown as { markdown: { getMarkdown: () => string } }
  return storage.markdown.getMarkdown()
}

const SCHEDULE = '<!-- sr due=2026-08-21 ease=2.50 interval=6 reps=2 -->'

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('insertOcclusionCards', () => {
  it('writes one card line per region, all pointing at the same image', () => {
    const e = mount('![Pipeline](Lecture%207.assets/p.png)')
    insertOcclusionCards(e, e.state.doc.content.size, 'Lecture 7.assets/p.png', 'Pipeline', [
      { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      { x: 0.5, y: 0.5, w: 0.25, h: 0.25 },
    ])

    const lines = markdownOf(e).split('\n').filter(Boolean)
    expect(lines).toEqual([
      '![Pipeline](Lecture%207.assets/p.png)',
      '![Pipeline](Lecture%207.assets/p.png "occlude=0.1,0.2,0.3,0.1")',
      '![Pipeline](Lecture%207.assets/p.png "occlude=0.5,0.5,0.25,0.25")',
    ])
  })

  it('survives a save and reload with each region keeping its own schedule', () => {
    const source = [
      '![a](x.png "occlude=0.1,0.1,0.2,0.2")',
      SCHEDULE,
      '![a](x.png "occlude=0.5,0.5,0.2,0.2")',
    ].join('\n')

    const saved = markdownOf(mount(source))
    expect(saved.split('\n').filter(Boolean)).toEqual(source.split('\n'))

    editor?.destroy()
    const reloaded = markdownOf(mount(saved))
    expect(reloaded).toBe(saved)
    const first = reloaded.split('\n').filter(Boolean)
    expect(parseOcclusionTitle(/"([^"]+)"/.exec(first[0] ?? '')?.[1])?.rect.x).toBe(0.1)
    expect(first[1]).toBe(SCHEDULE)
  })
})
