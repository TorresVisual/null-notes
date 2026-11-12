import { describe, it, expect, afterEach, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'
import { configureSpellcheck } from './Spellcheck'

const wrong = new Set(['wrold', 'recieve', 'Haus'])
const check = vi.fn(async (_lang: string, words: string[]) => new Set(words.filter((w) => wrong.has(w))))

vi.mock('../../lib/spellClient', () => ({
  misspelledWords: (lang: string, words: string[]) => check(lang, words),
  spellSuggestions: async () => [],
}))

let editor: Editor | null = null

function mount(content: string): Editor {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return editor
}

const squiggles = (e: Editor) => [...e.view.dom.querySelectorAll('.spell-error')].map((el) => el.textContent)

afterEach(() => {
  editor?.destroy()
  editor = null
  check.mockClear()
})

describe('Spellcheck extension', () => {
  it('underlines misspelled prose and nothing else', async () => {
    const e = mount('hello wrold and `recieve`\n\n```\nrecieve\n```\n')
    configureSpellcheck(e, { enabled: true, lang: 'en', personal: [] })
    await waitFor(() => expect(squiggles(e)).toEqual(['wrold']))
  })

  it('never asks the backend about code', async () => {
    const e = mount('prose `recieve`\n\n```\nrecieve\n```\n')
    configureSpellcheck(e, { enabled: true, lang: 'en', personal: [] })
    await waitFor(() => expect(check).toHaveBeenCalled())
    expect(check.mock.calls.flatMap(([, words]) => words)).toEqual(['prose'])
  })

  it('leaves personal-dictionary words alone, whatever their case', async () => {
    const e = mount('Start wrold Haus')
    configureSpellcheck(e, { enabled: true, lang: 'de', personal: ['HAUS'] })
    await waitFor(() => expect(squiggles(e)).toEqual(['wrold']))
  })

  it('clears every squiggle when switched off', async () => {
    const e = mount('Start wrold')
    configureSpellcheck(e, { enabled: true, lang: 'en', personal: [] })
    await waitFor(() => expect(squiggles(e)).toEqual(['wrold']))
    configureSpellcheck(e, { enabled: false, lang: 'en', personal: [] })
    await waitFor(() => expect(squiggles(e)).toEqual([]))
  })

  it('leaves the word under the caret plain until the caret moves on', async () => {
    const e = mount('wrold Start')
    configureSpellcheck(e, { enabled: true, lang: 'en', personal: [] })
    await waitFor(() => expect(check).toHaveBeenCalled())
    expect(squiggles(e)).toEqual([])
    e.commands.setTextSelection(e.state.doc.content.size - 1)
    await waitFor(() => expect(squiggles(e)).toEqual(['wrold']))
  })

  it('checks against the configured language', async () => {
    const e = mount('wrold')
    configureSpellcheck(e, { enabled: true, lang: 'de', personal: [] })
    await waitFor(() => expect(check).toHaveBeenCalledWith('de', ['wrold']))
  })
})
