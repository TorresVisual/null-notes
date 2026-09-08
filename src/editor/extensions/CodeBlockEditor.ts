import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list'
import { joinTextblockBackward } from '@tiptap/pm/commands'
import type { Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { useSettingsStore } from '../../store/settings'

// P11-3: what one Tab keypress inserts, and what one Shift+Tab removes.
// Read live from the settings store rather than passed in, same as
// `CodeBlockOpenInIde.ts`'s editor-command lookup — these are plain
// functions with no tiptap options plumbing of their own.
function indentUnit(): string {
  const { codeIndentWidth, codeIndentChar } = useSettingsStore.getState().settings
  return codeIndentChar === 'tab' ? '\t' : ' '.repeat(Math.max(1, codeIndentWidth))
}

function outdentPattern(): RegExp {
  const { codeIndentWidth, codeIndentChar } = useSettingsStore.getState().settings
  return codeIndentChar === 'tab' ? /^\t/ : new RegExp(`^ {1,${Math.max(1, codeIndentWidth)}}`)
}

interface AutoDetectLowlight {
  highlightAuto: (value: string) => { data?: { language?: string; relevance?: number } }
}

// Calibrated against real CS-lecture prose, not just real code: a paragraph
// of academic prose about, say, eigenvalues or induction proofs regularly
// scores 4-8 on lowlight's relevance scale — the same range plenty of short,
// genuine code snippets land in. There is no relevance value that reliably
// tells "plain paragraph a student pasted into a bare code block" apart from
// "real code" below roughly this line, so anything under it is left unset
// rather than risk mislabeling prose as a programming language — the same
// "prefer a miss" posture as every other resolver in this codebase (P1-1's
// unresolved wiki-links, P7-1's code links, P6-7's cross-references).
const MIN_CONFIDENT_RELEVANCE = 10

// P11-2: guess a pasted-in block's language once, the moment it has enough
// text to guess from — never on every keystroke, and never once a language
// is anything other than `null` (the schema default). `null` is "never
// decided"; an empty string is a real decision (the user picked "Plain
// text" from the toolbar, or a prior detection came up inconclusive), and
// both stop this from running again on that node, same as a real language
// pick would.
function detectPastedLanguage(lowlight: AutoDetectLowlight, transactions: readonly Transaction[], newState: { doc: ProseMirrorNode; tr: Transaction }): Transaction | null {
  if (!transactions.some((tr) => tr.getMeta('uiEvent') === 'paste')) return null

  let result: Transaction | null = null
  newState.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    if (node.attrs['language'] !== null) return false

    const text = node.textContent
    if (!text.trim()) return false

    const detected = lowlight.highlightAuto(text)
    if (!detected.data?.language || (detected.data.relevance ?? 0) < MIN_CONFIDENT_RELEVANCE) return false

    result = (result ?? newState.tr).setNodeMarkup(pos, undefined, { ...node.attrs, language: detected.data.language })
    return false
  })
  return result
}

const OPENING_PAIRS: Record<string, string> = {
  '"': '"',
  "'": "'",
  '(': ')',
  '[': ']',
  '{': '}',
  '`': '`',
}

const CLOSING_CHARACTERS = new Set(Object.values(OPENING_PAIRS))

function getCurrentLineIndent(text: string): string {
  const line = text.slice(text.lastIndexOf('\n') + 1)
  return line.match(/^[\t ]*/)?.[0] ?? ''
}

export function handleCodeBlockKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Tab' && event.key !== 'Enter') return false

  const { selection, schema } = view.state
  const { $from, empty, from, to } = selection
  if ($from.parent.type.name !== 'codeBlock') return false

  if (event.key === 'Tab') {
    event.preventDefault()

    if (event.shiftKey) {
      const outdentRe = outdentPattern()

      if (empty) {
        const beforeCursor = $from.parent.textContent.slice(0, $from.parentOffset)
        const lineStart = beforeCursor.lastIndexOf('\n') + 1
        const line = beforeCursor.slice(lineStart)
        const removed = line.match(outdentRe)?.[0].length ?? 0
        if (!removed) return true

        const start = $from.start() + lineStart
        const transaction = view.state.tr.delete(start, start + removed)
        transaction.setSelection(TextSelection.create(transaction.doc, Math.max(start, from - removed)))
        view.dispatch(transaction)
        return true
      }

      const text = view.state.doc.textBetween(from, to, '\n', '\n')
      const outdented = text.split('\n').map((line) => line.replace(outdentRe, '')).join('\n')
      view.dispatch(view.state.tr.replaceWith(from, to, schema.text(outdented)))
      return true
    }

    const unit = indentUnit()

    if (empty) {
      view.dispatch(view.state.tr.insertText(unit, from, to))
      return true
    }

    const text = view.state.doc.textBetween(from, to, '\n', '\n')
    const indented = text.split('\n').map((line) => `${unit}${line}`).join('\n')
    view.dispatch(view.state.tr.replaceWith(from, to, schema.text(indented)))
    return true
  }

  if (!empty) return false

  event.preventDefault()
  const beforeCursor = $from.parent.textContent.slice(0, $from.parentOffset)
  const afterCursor = $from.parent.textContent.slice($from.parentOffset)
  const indent = getCurrentLineIndent(beforeCursor)
  const opening = beforeCursor.at(-1)
  const closing = opening ? OPENING_PAIRS[opening] : undefined

  if (closing && afterCursor.startsWith(closing)) {
    const nestedIndent = `${indent}${indentUnit()}`
    const transaction = view.state.tr.insertText(`\n${nestedIndent}\n${indent}`, from, to)
    transaction.setSelection(TextSelection.create(transaction.doc, from + nestedIndent.length + 1))
    view.dispatch(transaction)
    return true
  }

  const nextIndent = /[{[(]\s*$/.test(beforeCursor) ? `${indent}${indentUnit()}` : indent
  view.dispatch(view.state.tr.insertText(`\n${nextIndent}`, from, to))
  return true
}

// TipTap's ListKeymap answers Backspace-at-item-start with liftListItem
// unconditionally, so backspacing at the start of the *second* item tears the
// list in half and leaves a paragraph wedged between the pieces. Every other
// editor joins into the previous item there, and lifts only from the first
// item — which ListKeymap still handles, so this only claims the join case.
function shouldJoinIntoPreviousListItem(view: EditorView): boolean {
  const { $from, empty } = view.state.selection
  if (!empty || $from.parentOffset !== 0) return false

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name
    if (name !== 'listItem' && name !== 'taskItem') continue
    // A later block inside the same item always has a textblock above it to
    // merge into; only the item's *first* block needs a preceding item.
    if ($from.index(depth) > 0) return true
    return $from.index(depth - 1) > 0
  }

  return false
}

function findListItemType(view: EditorView): NodeType | null {
  const { $from } = view.state.selection

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const type = $from.node(depth).type
    if (type.name === 'listItem' || type.name === 'taskItem') return type
  }

  return null
}

export function handleEditorKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  if (handleCodeBlockKeyDown(view, event)) return true

  if (event.key === 'Backspace') {
    const { empty, from } = view.state.selection
    if (!empty || from === 0) return false

    if (shouldJoinIntoPreviousListItem(view)) {
      event.preventDefault()
      // joinTextblockBackward, not joinBackward: the latter moves the item's
      // whole content in as a sibling block, which just relocates the mess.
      return joinTextblockBackward(view.state, view.dispatch, view)
    }

    const opening = view.state.doc.textBetween(from - 1, from)
    const closing = OPENING_PAIRS[opening]
    const nextCharacter = view.state.doc.textBetween(from, from + 1)

    if (!closing || closing !== nextCharacter) return false

    event.preventDefault()
    const transaction = view.state.tr.delete(from - 1, from + 1)
    transaction.setSelection(TextSelection.create(transaction.doc, from - 1))
    view.dispatch(transaction)
    return true
  }

  if (event.key !== 'Tab') return false

  event.preventDefault()
  const itemType = findListItemType(view)
  if (itemType) {
    const command = event.shiftKey ? liftListItem(itemType) : sinkListItem(itemType)
    return command(view.state, view.dispatch)
  }

  const { from, to } = view.state.selection
  view.dispatch(view.state.tr.insertText('\u00a0\u00a0', from, to))
  return true
}

export function handleEditorTextInput(view: EditorView, from: number, to: number, text: string): boolean {
  if (view.state.selection.$from.parent.type.name === 'codeBlock') return false

  const previousCharacter = view.state.doc.textBetween(from - 1, from)
  const currentCharacter = view.state.doc.textBetween(from, from + text.length)

  if (text === '[' && previousCharacter === '[' && currentCharacter === ']') {
    const transaction = view.state.tr.insertText(text, from, to).delete(from + 1, from + 2)
    transaction.setSelection(TextSelection.create(transaction.doc, from + 1))
    view.dispatch(transaction)
    return true
  }

  const closing = OPENING_PAIRS[text]
  const quoteFollowsWord = (text === '"' || text === "'") && /[\p{L}\p{N}]/u.test(previousCharacter)
  if (closing && !quoteFollowsWord) {
    const transaction = view.state.tr.insertText(`${text}${closing}`, from, to)
    transaction.setSelection(TextSelection.create(transaction.doc, from + text.length))
    view.dispatch(transaction)
    return true
  }

  if (currentCharacter === text && CLOSING_CHARACTERS.has(text)) {
    const transaction = view.state.tr.setSelection(TextSelection.create(view.state.doc, from + text.length))
    view.dispatch(transaction)
    return true
  }

  return false
}

export const CodeBlockEditor = CodeBlockLowlight.extend({

  // Presentation-only, like `Details`' collapse state (P6-1): word-wrap is a
  // per-block view preference, not content, and tiptap-markdown's built-in
  // codeBlock serializer only ever reads `language` — so this never reaches
  // the fence info string and never dirties the round-trip.
  addAttributes() {
    return {
      ...this.parent?.(),
      wrap: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-wrap') === 'true',
        renderHTML: (attributes) => ({ 'data-wrap': attributes['wrap'] ? 'true' : 'false' }),
      },
    }
  },

  addProseMirrorPlugins() {
    // @tiptap/extension-code-block's own "codeBlockVSCodeHandler" plugin
    // (inherited via CodeBlockLowlight) wraps ANY paste tagged with
    // clipboard mimetype `vscode-editor-data` into a single code block using
    // that source editor's language mode — unconditionally, before
    // tiptap-markdown's paste parser ever runs. VS Code (and the
    // Monaco/CodeMirror embeds many doc sites use) tags a copied markdown
    // file with mode "markdown", so pasting a note's own source text turned
    // into one giant `language: markdown` code block instead of content.
    // Swap in the same plugin minus that one case; everything else (Python,
    // Rust, ...) still auto-detects as before.
    // `.key` is set at runtime (prosemirror-state's Plugin constructor) but
    // not part of the public .d.ts.
    const parentPlugins = (this.parent?.() ?? []).filter(
      (plugin) => !(plugin as unknown as { key: string }).key.startsWith('codeBlockVSCodeHandler$'),
    )
    const lowlight = this.options.lowlight as AutoDetectLowlight

    return [
      ...parentPlugins,
      new Plugin({
        key: new PluginKey('codeBlockVSCodeHandler'),
        props: {
          handlePaste: (view, event) => {
            if (!event.clipboardData) return false
            if (this.editor.isActive(this.type.name)) return false

            const text = event.clipboardData.getData('text/plain')
            const vscode = event.clipboardData.getData('vscode-editor-data')
            const vscodeData = vscode ? (JSON.parse(vscode) as { mode?: string }) : undefined
            const language = vscodeData?.mode
            if (!text) return false

            // A markdown-mode source is this app's own content format, not
            // code to wrap — run it through tiptap-markdown's own paste
            // parser (same one plain-text paste already uses) so task
            // lists, headings, etc. come in as real nodes instead of escaped
            // text. HTML-flavored paste normally wins over plain text, which
            // is exactly what skipped this case before.
            if (language === 'markdown') {
              const slice = view.someProp('clipboardTextParser', (f) => f(text, view.state.selection.$from, false, view))
              if (!slice) return false
              const tr = view.state.tr.replaceSelection(slice)
              tr.setMeta('uiEvent', 'paste')
              view.dispatch(tr)
              return true
            }

            if (!language) return false

            const { tr, schema } = view.state
            const textNode = schema.text(text.replace(/\r\n?/g, '\n'))
            tr.replaceSelectionWith(this.type.create({ language }, textNode))
            if (tr.selection.$from.parent.type !== this.type) {
              tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, tr.selection.from - 2))))
            }
            tr.setMeta('paste', true)
            view.dispatch(tr)
            return true
          },
        },
      }),
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => detectPastedLanguage(lowlight, transactions, newState),
      }),
      new Plugin({
        props: {
          handleTextInput: (view, from, to, text) => {
            const { $from } = view.state.selection
            if ($from.parent.type !== this.type) return false

            const closing = OPENING_PAIRS[text]
            if (closing) {
              const transaction = view.state.tr.insertText(`${text}${closing}`, from, to)
              transaction.setSelection(TextSelection.create(transaction.doc, from + text.length))
              view.dispatch(transaction)
              return true
            }

            const currentCharacter = view.state.doc.textBetween(from, from + text.length)
            if (currentCharacter === text && Object.values(OPENING_PAIRS).includes(text)) {
              const transaction = view.state.tr.setSelection(TextSelection.create(view.state.doc, from + text.length))
              view.dispatch(transaction)
              return true
            }

            return false
          },
        },
      }),
    ]
  },
})
