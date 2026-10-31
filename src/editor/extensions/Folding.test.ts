import { describe, it, expect, afterEach } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'
import { useFocusModeStore } from '../../store/focusMode'
import { REVEAL_FOLD_EVENT, revealPos } from './Folding'

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./index')

type TestEditor = InstanceType<typeof Editor>
let editor: TestEditor | null = null

function mount(content: string): TestEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content })
  return editor
}

function hiddenTexts(e: TestEditor): string[] {
  return [...e.view.dom.querySelectorAll('.fold-hidden')].map((el) => (el.textContent ?? '').replace('▸', ''))
}

function toggles(e: TestEditor): HTMLElement[] {
  return [...e.view.dom.querySelectorAll<HTMLElement>('.fold-toggle')]
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
}

function posOf(e: TestEditor, needle: string): number {
  let found = -1
  e.state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    const index = node.isText ? (node.text ?? '').indexOf(needle) : -1
    if (index !== -1) found = pos + index
    return true
  })
  if (found < 0) throw new Error(`no text "${needle}"`)
  return found
}

afterEach(() => {
  editor?.destroy()
  editor = null
  useFocusModeStore.setState({ enabled: false })
})

const NOTE = '<h1>One</h1><p>a</p><h2>Mid</h2><p>b</p><h1>Two</h1><p>c</p>'

describe('Folding headings', () => {
  it('folds a heading section up to the next heading of the same or higher level', () => {
    const e = mount(NOTE)
    click(toggles(e)[0]!)

    expect(hiddenTexts(e)).toEqual(['a', 'Mid', 'b'])
  })

  it('folds only the subsection for a nested heading', () => {
    const e = mount(NOTE)
    click(toggles(e)[1]!)

    expect(hiddenTexts(e)).toEqual(['b'])
  })

  it('never changes the document', () => {
    const e = mount(NOTE)
    const before = e.getHTML()
    e.commands.foldAll()

    expect(hiddenTexts(e).length).toBeGreaterThan(0)
    expect(e.getHTML()).toBe(before)
  })

  it('foldAll then unfoldAll', () => {
    const e = mount(NOTE)
    e.commands.foldAll()
    expect(hiddenTexts(e)).toEqual(['a', 'Mid', 'b', 'c'])

    e.commands.unfoldAll()
    expect(hiddenTexts(e)).toEqual([])
  })

  it('offers no toggle on a heading with nothing under it', () => {
    const e = mount('<h1>Only</h1>')

    expect(toggles(e)).toHaveLength(0)
  })

  it('keeps the fold on its heading when text is inserted above', () => {
    const e = mount(NOTE)
    click(toggles(e)[1]!)
    e.commands.insertContentAt(0, '<p>new</p>')

    expect(hiddenTexts(e)).toEqual(['b'])
  })

  it('unfolds when the caret lands in hidden content', () => {
    const e = mount(NOTE)
    click(toggles(e)[0]!)
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, posOf(e, 'b'))))

    expect(hiddenTexts(e)).toEqual([])
  })

  it('moves a caret out of the section it just folded', () => {
    const e = mount(NOTE)
    e.commands.setTextSelection(posOf(e, 'a'))
    click(toggles(e)[0]!)

    expect(e.state.selection.$from.parent.type.name).toBe('heading')
    expect(hiddenTexts(e)).toEqual(['a', 'Mid', 'b'])
  })

  it('revealPos unfolds the fold hiding a position', () => {
    const e = mount(NOTE)
    e.commands.foldAll()
    revealPos(e.view, posOf(e, 'b'))

    expect(hiddenTexts(e)).toEqual(['c'])
  })

  it('the reveal event unfolds a heading hidden inside a fold', () => {
    const e = mount(NOTE)
    e.commands.foldAll()
    const sub = e.view.dom.querySelectorAll('h2')[0]!
    sub.dispatchEvent(new Event(REVEAL_FOLD_EVENT, { bubbles: true }))

    expect(hiddenTexts(e)).toEqual(['c'])
  })

  it('find unfolds the section holding the active match', () => {
    const e = mount(NOTE)
    e.commands.foldAll()
    e.view.someProp('handleKeyDown', (f) =>
      (f as (v: typeof e.view, ev: KeyboardEvent) => boolean)(e.view, new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true })),
    )
    const input = e.view.dom.parentElement?.querySelector<HTMLInputElement>('.note-find-input')
    if (!input) throw new Error('find bar missing')
    input.value = 'b'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    expect(hiddenTexts(e)).toEqual(['c'])
  })

  it('keeps focus mode dimming alongside folds', () => {
    const e = mount(NOTE)
    useFocusModeStore.getState().toggle()
    e.commands.setTextSelection(posOf(e, 'c'))
    click(toggles(e)[0]!)

    expect(e.view.dom.querySelectorAll('.focus-mode-dim').length).toBeGreaterThan(0)
    expect(hiddenTexts(e)).toEqual(['a', 'Mid', 'b'])
  })
})

describe('Folding list items', () => {
  const LIST = '<ul><li><p>parent</p><ul><li><p>child</p></li></ul></li><li><p>leaf</p></li></ul>'

  it('only list items with nested content get a toggle', () => {
    const e = mount(LIST)

    expect(toggles(e)).toHaveLength(1)
  })

  it('hides everything after the first child', () => {
    const e = mount(LIST)
    click(toggles(e)[0]!)

    expect(hiddenTexts(e)).toEqual(['child'])
  })
})
