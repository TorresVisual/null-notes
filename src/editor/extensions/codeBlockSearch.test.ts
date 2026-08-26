import { describe, it, expect, afterEach } from 'vitest'
import { findMatches } from './CodeBlockSearch'

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./index')

let editor: InstanceType<typeof Editor> | null = null

function mount(content: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content })
  return editor
}

function codeBlock(text: string): string {
  return `<pre><code>${text}</code></pre>`
}

function caretIn(e: InstanceType<typeof Editor>, needle: string): void {
  let position: number | null = null
  e.state.doc.descendants((node, pos) => {
    if (position !== null) return false
    if (!node.isText) return true
    const index = (node.text ?? '').indexOf(needle)
    if (index !== -1) position = pos + index
    return true
  })
  if (position === null) throw new Error(`no text node containing "${needle}"`)
  e.commands.setTextSelection(position)
}

type HandleKeyDown = (view: InstanceType<typeof Editor>['view'], event: KeyboardEvent) => boolean | void

function pressCtrlF(e: InstanceType<typeof Editor>, shiftKey = false): boolean | void {
  const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey, bubbles: true, cancelable: true })
  return e.view.someProp('handleKeyDown', (f) => (f as unknown as HandleKeyDown)(e.view, event))
}

function pressEscape(e: InstanceType<typeof Editor>): boolean | void {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  return e.view.someProp('handleKeyDown', (f) => (f as unknown as HandleKeyDown)(e.view, event))
}

function searchBar(e: InstanceType<typeof Editor>): HTMLElement | null {
  return e.view.dom.querySelector('.code-search-bar')
}

function searchInput(e: InstanceType<typeof Editor>): HTMLInputElement {
  const input = e.view.dom.querySelector('.code-search-input')
  if (!(input instanceof HTMLInputElement)) throw new Error('no .code-search-input rendered')
  return input
}

function typeQuery(e: InstanceType<typeof Editor>, text: string): void {
  const input = searchInput(e)
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function pressOnInput(e: InstanceType<typeof Editor>, key: string, shiftKey = false): void {
  searchInput(e).dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
}

function matchTexts(e: InstanceType<typeof Editor>): string[] {
  return [...e.view.dom.querySelectorAll('.code-search-match')].map((el) => el.textContent ?? '')
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('findMatches (pure)', () => {
  it('returns no matches for an empty query', () => {
    expect(findMatches('hello world', '')).toEqual([])
  })

  it('matches case-insensitively', () => {
    expect(findMatches('Hello World', 'world')).toEqual([6])
  })

  it('finds every non-overlapping occurrence', () => {
    expect(findMatches('aaaa', 'aa')).toEqual([0, 2])
  })

  it('returns no matches when the query is absent', () => {
    expect(findMatches('hello', 'xyz')).toEqual([])
  })
})

describe('in-block search (P11-3)', () => {
  it('Ctrl+F opens the search bar only when the caret is inside a code block', () => {
    const e = mount(`<p>prose</p>${codeBlock('let x = 1;')}`)

    caretIn(e, 'prose')
    expect(pressCtrlF(e)).toBeFalsy()
    expect(searchBar(e)).toBeNull()

    caretIn(e, 'x')
    expect(pressCtrlF(e)).toBeTruthy()
    expect(searchBar(e)).not.toBeNull()
  })

  it('highlights every match as the query is typed', () => {
    const e = mount(codeBlock('let x = 1;\nlet y = x + 1;'))
    caretIn(e, 'x')
    pressCtrlF(e)

    typeQuery(e, 'let')

    expect(matchTexts(e)).toEqual(['let', 'let'])
  })

  it('marks exactly one match as active, and Enter advances it', () => {
    const e = mount(codeBlock('aa aa aa'))
    caretIn(e, 'aa')
    pressCtrlF(e)
    typeQuery(e, 'aa')

    const activeText = () => e.view.dom.querySelector('.code-search-match-active')?.textContent
    expect(e.view.dom.querySelectorAll('.code-search-match-active')).toHaveLength(1)

    pressOnInput(e, 'Enter')
    pressOnInput(e, 'Enter')
    // Wraps back to the first match after the third of three.
    pressOnInput(e, 'Enter')
    expect(activeText()).toBe('aa')
  })

  it('Shift+Enter moves backward, wrapping to the last match', () => {
    const e = mount(codeBlock('aa aa aa'))
    caretIn(e, 'aa')
    pressCtrlF(e)
    typeQuery(e, 'aa')

    pressOnInput(e, 'Enter', true)

    expect(e.view.dom.querySelectorAll('.code-search-match-active')).toHaveLength(1)
  })

  it('Escape closes the bar and clears all highlights', () => {
    const e = mount(codeBlock('let x = 1;'))
    caretIn(e, 'x')
    pressCtrlF(e)
    typeQuery(e, 'let')
    expect(matchTexts(e)).toHaveLength(1)

    pressOnInput(e, 'Escape')

    expect(searchBar(e)).toBeNull()
    expect(matchTexts(e)).toHaveLength(0)
  })

  it('Escape from the editor itself (not just the input) also closes an open search', () => {
    const e = mount(codeBlock('let x = 1;'))
    caretIn(e, 'x')
    pressCtrlF(e)

    expect(pressEscape(e)).toBeTruthy()
    expect(searchBar(e)).toBeNull()
  })

  it('keeps tracking the block when an edit lands before it', () => {
    const e = mount(`<p>prose</p>${codeBlock('let x = 1;')}`)
    caretIn(e, 'x')
    pressCtrlF(e)
    typeQuery(e, 'let')
    expect(matchTexts(e)).toHaveLength(1)

    e.commands.insertContentAt(0, 'more ')

    expect(searchBar(e)).not.toBeNull()
    expect(matchTexts(e)).toHaveLength(1)
  })

  it('auto-closes if the searched block itself is deleted', () => {
    const e = mount(codeBlock('let x = 1;'))
    caretIn(e, 'x')
    pressCtrlF(e)
    typeQuery(e, 'let')

    e.commands.command(({ tr, dispatch }) => {
      dispatch?.(tr.delete(0, tr.doc.content.size))
      return true
    })

    expect(searchBar(e)).toBeNull()
  })
})
