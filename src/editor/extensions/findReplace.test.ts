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

function inlineMath(latex: string): string {
  return `<span data-type="inline-math" data-latex="${latex}"></span>`
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

// The bar lives outside `view.dom` now (see FindReplace.ts's file header) —
// appended as a sibling of the ProseMirror root within the same mount
// container, so a document-wide query finds it. Only one editor is ever
// mounted at a time in this file (afterEach tears it down), so this is safe.
function findBar(): HTMLElement | null {
  return document.querySelector('.note-find-bar')
}

function findInput(): HTMLInputElement {
  const input = document.querySelector('.note-find-input')
  if (!(input instanceof HTMLInputElement)) throw new Error('no .note-find-input rendered')
  return input
}

function replaceInput(): HTMLInputElement {
  const input = document.querySelector('.note-find-replace-input')
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

function clickButton(selector: string): void {
  const button = document.querySelector(selector)
  if (!(button instanceof HTMLElement)) throw new Error(`no element matching ${selector}`)
  button.click()
}

function clickOption(option: string): void {
  clickButton(`.note-find-option[data-option="${option}"]`)
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

  it('finds matches across separate paragraphs, case-insensitively by default', () => {
    const e = mount('<p>Hello there</p><p>hello again</p>')
    const matches = findDocMatches(e.state.doc, 'hello')
    expect(matches).toHaveLength(2)
    for (const { from, to } of matches) {
      expect(e.state.doc.textBetween(from, to).toLowerCase()).toBe('hello')
    }
  })

  it('matches text inside a code block too', () => {
    const e = mount(`<p>needle in prose</p>${codeBlock('needle in code')}`)
    const matches = findDocMatches(e.state.doc, 'needle')
    expect(matches).toHaveLength(2)
  })

  it('matches an equation whose LaTeX contains the query, as a whole-node match', () => {
    const e = mount(`<p>see ${inlineMath('x^2 + y^2')} below</p>`)
    const matches = findDocMatches(e.state.doc, 'x^2')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.kind).toBe('node')
  })

  it('case-sensitive option excludes differently-cased matches', () => {
    const e = mount('<p>Hello hello</p>')
    const insensitive = findDocMatches(e.state.doc, 'Hello', { caseSensitive: false, wholeWord: false, useRegex: false })
    const sensitive = findDocMatches(e.state.doc, 'Hello', { caseSensitive: true, wholeWord: false, useRegex: false })
    expect(insensitive).toHaveLength(2)
    expect(sensitive).toHaveLength(1)
  })

  it('whole-word option excludes partial-word matches', () => {
    const e = mount('<p>cat concatenate</p>')
    const partial = findDocMatches(e.state.doc, 'cat', { caseSensitive: false, wholeWord: false, useRegex: false })
    const whole = findDocMatches(e.state.doc, 'cat', { caseSensitive: false, wholeWord: true, useRegex: false })
    expect(partial).toHaveLength(2)
    expect(whole).toHaveLength(1)
  })

  it('regex option treats the query as a pattern', () => {
    const e = mount('<p>cat1 cat2 dog3</p>')
    const matches = findDocMatches(e.state.doc, 'cat\\d', { caseSensitive: false, wholeWord: false, useRegex: true })
    expect(matches).toHaveLength(2)
  })

  it('an invalid regex pattern yields no matches instead of throwing', () => {
    const e = mount('<p>hello</p>')
    expect(() => findDocMatches(e.state.doc, '(unclosed', { caseSensitive: false, wholeWord: false, useRegex: true })).not.toThrow()
    expect(findDocMatches(e.state.doc, '(unclosed', { caseSensitive: false, wholeWord: false, useRegex: true })).toEqual([])
  })
})

describe('note-wide find/replace (P6 polish backlog)', () => {
  it('Ctrl+F opens the bar outside a code block, and falls through to CodeBlockSearch inside one', () => {
    const e = mount(`<p>prose</p>${codeBlock('let x = 1;')}`)

    caretIn(e, 'prose')
    expect(pressCtrlF(e)).toBeTruthy()
    expect(findBar()).not.toBeNull()
    pressEscape(e)

    caretIn(e, 'x')
    pressCtrlF(e)
    expect(findBar()?.hidden).toBe(true)
  })

  it('highlights every match as the query is typed', () => {
    const e = mount('<p>alpha beta alpha</p>')
    pressCtrlF(e)

    typeInto(findInput(), 'alpha')

    expect(matchTexts(e)).toEqual(['alpha', 'alpha'])
  })

  it('Enter advances the active match and wraps around', () => {
    const e = mount('<p>aa aa aa</p>')
    pressCtrlF(e)
    typeInto(findInput(), 'aa')

    const activeText = () => e.view.dom.querySelector('.note-find-match-active')?.textContent
    expect(e.view.dom.querySelectorAll('.note-find-match-active')).toHaveLength(1)

    pressOnInput(findInput(), 'Enter')
    pressOnInput(findInput(), 'Enter')
    pressOnInput(findInput(), 'Enter')
    expect(activeText()).toBe('aa')
  })

  it('Escape closes the bar and clears all highlights', () => {
    const e = mount('<p>alpha beta</p>')
    pressCtrlF(e)
    typeInto(findInput(), 'alpha')
    expect(matchTexts(e)).toHaveLength(1)

    pressOnInput(findInput(), 'Escape')

    expect(findBar()?.hidden).toBe(true)
    expect(matchTexts(e)).toHaveLength(0)
  })

  it('replaces the active match only', () => {
    const e = mount('<p>alpha beta alpha</p>')
    pressCtrlF(e)
    typeInto(findInput(), 'alpha')
    clickButton('.note-find-toggle-replace')
    typeInto(replaceInput(), 'gamma')

    clickButton('.note-find-replace-one')

    expect(e.getText()).toBe('gamma beta alpha')
  })

  it('replaces every match at once', () => {
    const e = mount('<p>alpha beta alpha</p>')
    pressCtrlF(e)
    typeInto(findInput(), 'alpha')
    clickButton('.note-find-toggle-replace')
    typeInto(replaceInput(), 'gamma')

    clickButton('.note-find-replace-all')

    expect(e.getText()).toBe('gamma beta gamma')
  })

  it('searches and replaces inside a code block too', () => {
    const e = mount(`<p>needle in prose</p>${codeBlock('needle in code')}`)
    caretIn(e, 'prose')
    pressCtrlF(e)
    typeInto(findInput(), 'needle')
    clickButton('.note-find-toggle-replace')
    typeInto(replaceInput(), 'pin')
    clickButton('.note-find-replace-all')

    expect(e.getText()).toContain('pin in prose')
    expect(e.getText()).toContain('pin in code')
  })

  it('toggling case-sensitive narrows the highlighted matches', () => {
    const e = mount('<p>Hello hello</p>')
    pressCtrlF(e)
    typeInto(findInput(), 'Hello')
    expect(matchTexts(e)).toHaveLength(2)

    clickOption('caseSensitive')

    expect(matchTexts(e)).toEqual(['Hello'])
  })

  it('an invalid regex shows an error instead of matches', () => {
    const e = mount('<p>hello</p>')
    pressCtrlF(e)
    clickOption('useRegex')
    typeInto(findInput(), '(unclosed')

    expect(matchTexts(e)).toHaveLength(0)
    expect(document.querySelector('.note-find-count')?.textContent).toBe('Invalid regex')
  })
})
