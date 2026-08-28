import { describe, it, expect, afterEach } from 'vitest'
import { findDocMatches } from './FindReplace'

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

function pressCtrlF(e: InstanceType<typeof Editor>): boolean | void {
  const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
  return e.view.someProp('handleKeyDown', (f) => (f as unknown as HandleKeyDown)(e.view, event))
}

function pressEscape(e: InstanceType<typeof Editor>): boolean | void {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  return e.view.someProp('handleKeyDown', (f) => (f as unknown as HandleKeyDown)(e.view, event))
}

function findBar(e: InstanceType<typeof Editor>): HTMLElement | null {
  return e.view.dom.querySelector('.note-find-bar')
}

function findInput(e: InstanceType<typeof Editor>): HTMLInputElement {
  const input = e.view.dom.querySelector('.note-find-input')
  if (!(input instanceof HTMLInputElement)) throw new Error('no .note-find-input rendered')
  return input
}

function replaceInput(e: InstanceType<typeof Editor>): HTMLInputElement {
  const input = e.view.dom.querySelector('.note-find-replace-input')
  if (!(input instanceof HTMLInputElement)) throw new Error('no .note-find-replace-input rendered')
  return input
}

function typeInto(input: HTMLInputElement, text: string): void {
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function pressOnInput(input: HTMLInputElement, key: string, shiftKey = false): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
}

function matchTexts(e: InstanceType<typeof Editor>): string[] {
  return [...e.view.dom.querySelectorAll('.note-find-match')].map((el) => el.textContent ?? '')
}

function clickButton(e: InstanceType<typeof Editor>, selector: string): void {
  const button = e.view.dom.querySelector(selector)
  if (!(button instanceof HTMLElement)) throw new Error(`no element matching ${selector}`)
  button.click()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('findDocMatches (pure-ish, over a real doc)', () => {
  it('returns no matches for an empty query', () => {
    const e = mount('<p>hello world</p>')
    expect(findDocMatches(e.state.doc, '')).toEqual([])
  })

  it('finds matches across separate paragraphs, case-insensitively', () => {
    const e = mount('<p>Hello there</p><p>hello again</p>')
    const matches = findDocMatches(e.state.doc, 'hello')
    expect(matches).toHaveLength(2)
    for (const { from, to } of matches) {
      expect(e.state.doc.textBetween(from, to).toLowerCase()).toBe('hello')
    }
  })

  it('skips text inside a code block', () => {
    const e = mount(`<p>needle in prose</p>${codeBlock('needle in code')}`)
    const matches = findDocMatches(e.state.doc, 'needle')
    expect(matches).toHaveLength(1)
    expect(e.state.doc.textBetween(matches[0]!.from, matches[0]!.to)).toBe('needle')
  })
})

describe('note-wide find/replace (P6 polish backlog)', () => {
  it('Ctrl+F opens the bar outside a code block, and falls through to CodeBlockSearch inside one', () => {
    const e = mount(`<p>prose</p>${codeBlock('let x = 1;')}`)

    caretIn(e, 'prose')
    expect(pressCtrlF(e)).toBeTruthy()
    expect(findBar(e)).not.toBeNull()
    pressEscape(e)

    caretIn(e, 'x')
    pressCtrlF(e)
    expect(findBar(e)).toBeNull()
  })

  it('highlights every match as the query is typed', () => {
    const e = mount('<p>alpha beta alpha</p>')
    pressCtrlF(e)

    typeInto(findInput(e), 'alpha')

    expect(matchTexts(e)).toEqual(['alpha', 'alpha'])
  })

  it('Enter advances the active match and wraps around', () => {
    const e = mount('<p>aa aa aa</p>')
    pressCtrlF(e)
    typeInto(findInput(e), 'aa')

    const activeText = () => e.view.dom.querySelector('.note-find-match-active')?.textContent
    expect(e.view.dom.querySelectorAll('.note-find-match-active')).toHaveLength(1)

    pressOnInput(findInput(e), 'Enter')
    pressOnInput(findInput(e), 'Enter')
    pressOnInput(findInput(e), 'Enter')
    expect(activeText()).toBe('aa')
  })

  it('Escape closes the bar and clears all highlights', () => {
    const e = mount('<p>alpha beta</p>')
    pressCtrlF(e)
    typeInto(findInput(e), 'alpha')
    expect(matchTexts(e)).toHaveLength(1)

    pressOnInput(findInput(e), 'Escape')

    expect(findBar(e)).toBeNull()
    expect(matchTexts(e)).toHaveLength(0)
  })

  it('replaces the active match only', () => {
    const e = mount('<p>alpha beta alpha</p>')
    pressCtrlF(e)
    typeInto(findInput(e), 'alpha')
    clickButton(e, '.note-find-toggle-replace')
    typeInto(replaceInput(e), 'gamma')

    clickButton(e, '.note-find-replace-one')

    expect(e.getText()).toBe('gamma beta alpha')
  })

  it('replaces every match at once', () => {
    const e = mount('<p>alpha beta alpha</p>')
    pressCtrlF(e)
    typeInto(findInput(e), 'alpha')
    clickButton(e, '.note-find-toggle-replace')
    typeInto(replaceInput(e), 'gamma')

    clickButton(e, '.note-find-replace-all')

    expect(e.getText()).toBe('gamma beta gamma')
  })

  it('never searches or replaces inside a code block', () => {
    const e = mount(codeBlock('needle'))
    pressCtrlF(e)
    // Ctrl+F with the caret inside a code block falls through (previous
    // test covers that); place the caret in prose instead by prepending one.
    e.destroy()

    const e2 = mount(`<p>needle in prose</p>${codeBlock('needle in code')}`)
    caretIn(e2, 'prose')
    pressCtrlF(e2)
    typeInto(findInput(e2), 'needle')
    clickButton(e2, '.note-find-toggle-replace')
    typeInto(replaceInput(e2), 'pin')
    clickButton(e2, '.note-find-replace-all')

    expect(e2.getText()).toContain('pin in prose')
    expect(e2.getText()).toContain('needle in code')
    e2.destroy()
  })
})
