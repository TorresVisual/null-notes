import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'
import { handleEditorKeyDown, handleEditorTextInput } from './CodeBlockEditor'
import { useSettingsStore, DEFAULT_SETTINGS } from '../../store/settings'

let editor: Editor | null = null

// Mirrors NoteEditor's own editorProps (see listBoundaries.test.ts) — a
// mount without them tests an editor the app never actually builds, since
// Tab/Enter handling for code blocks lives here, ahead of every keymap
// plugin, not inside an extension.
function mount(content: string): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: coreExtensions,
    content,
    editorProps: {
      handleKeyDown: handleEditorKeyDown,
      handleTextInput: handleEditorTextInput,
    },
  })
  return editor
}

type KeyDownHandler = (view: Editor['view'], event: KeyboardEvent) => boolean | void

function press(instance: Editor, key: string, shiftKey = false): void {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })
  instance.view.someProp('handleKeyDown', (f) => (f as unknown as KeyDownHandler)(instance.view, event))
}

function caretAfter(instance: Editor, needle: string): void {
  let position: number | null = null
  instance.state.doc.descendants((node, pos) => {
    if (position !== null) return false
    if (!node.isText) return true
    const index = (node.text ?? '').indexOf(needle)
    if (index !== -1) position = pos + index + needle.length
    return true
  })
  if (position === null) throw new Error(`no text node containing "${needle}"`)
  instance.commands.setTextSelection(position)
}

function codeBlockText(instance: Editor): string {
  let text = ''
  instance.state.doc.descendants((node) => {
    if (node.type.name === 'codeBlock') text = node.textContent
    return false
  })
  return text
}

/** Selects the full text content of the (single) code block in the doc. */
function selectCodeBlockContent(instance: Editor): void {
  let range: { from: number; to: number } | null = null
  instance.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    range = { from: pos + 1, to: pos + 1 + node.content.size }
    return false
  })
  if (!range) throw new Error('no codeBlock node found')
  instance.commands.setTextSelection(range)
}

afterEach(() => {
  editor?.destroy()
  editor = null
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
})

describe('code block indent settings (P11-3)', () => {
  it('defaults to two spaces, matching the pre-existing hardcoded behavior', () => {
    const e = mount('<pre><code>x</code></pre>')
    caretAfter(e, 'x')
    press(e, 'Tab')
    expect(codeBlockText(e)).toBe('x  ')
  })

  it('Tab inserts the configured space width', () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, codeIndentWidth: 4, codeIndentChar: 'space' as const } }))
    const e = mount('<pre><code>x</code></pre>')
    caretAfter(e, 'x')
    press(e, 'Tab')
    expect(codeBlockText(e)).toBe('x    ')
  })

  it('Tab inserts a literal tab character when configured', () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, codeIndentChar: 'tab' as const } }))
    const e = mount('<pre><code>x</code></pre>')
    caretAfter(e, 'x')
    press(e, 'Tab')
    expect(codeBlockText(e)).toBe('x\t')
  })

  it('Shift+Tab removes up to the configured width, not a hardcoded amount', () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, codeIndentWidth: 4, codeIndentChar: 'space' as const } }))
    const e = mount('<pre><code>    x</code></pre>')
    caretAfter(e, 'x')
    press(e, 'Tab', true)
    expect(codeBlockText(e)).toBe('x')
  })

  it('Shift+Tab removes exactly one leading tab in tab mode', () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, codeIndentChar: 'tab' as const } }))
    const e = mount('<pre><code>\t\tx</code></pre>')
    caretAfter(e, 'x')
    press(e, 'Tab', true)
    expect(codeBlockText(e)).toBe('\tx')
  })

  it('indents every line of a multi-line selection with the configured unit', () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, codeIndentChar: 'tab' as const } }))
    const e = mount('<pre><code>one\ntwo</code></pre>')
    selectCodeBlockContent(e)
    press(e, 'Tab')
    expect(codeBlockText(e)).toBe('\tone\n\ttwo')
  })

  it('nests one configured unit deeper after an opening brace', () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, codeIndentChar: 'tab' as const } }))
    const e = mount('<pre><code>if (x) {</code></pre>')
    caretAfter(e, '{')
    press(e, 'Enter')
    expect(codeBlockText(e)).toBe('if (x) {\n\t')
  })
})
