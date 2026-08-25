import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list'
import { joinTextblockBackward } from '@tiptap/pm/commands'
import type { NodeType } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

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
      if (empty) {
        const beforeCursor = $from.parent.textContent.slice(0, $from.parentOffset)
        const lineStart = beforeCursor.lastIndexOf('\n') + 1
        const line = beforeCursor.slice(lineStart)
        const spaces = line.match(/^ {1,2}/)?.[0].length ?? 0
        if (!spaces) return true

        const start = $from.start() + lineStart
        const transaction = view.state.tr.delete(start, start + spaces)
        transaction.setSelection(TextSelection.create(transaction.doc, Math.max(start, from - spaces)))
        view.dispatch(transaction)
        return true
      }

      const text = view.state.doc.textBetween(from, to, '\n', '\n')
      const outdented = text.split('\n').map((line) => line.replace(/^ {1,2}/, '')).join('\n')
      view.dispatch(view.state.tr.replaceWith(from, to, schema.text(outdented)))
      return true
    }

    if (empty) {
      view.dispatch(view.state.tr.insertText('  ', from, to))
      return true
    }

    const text = view.state.doc.textBetween(from, to, '\n', '\n')
    const indented = text.split('\n').map((line) => `  ${line}`).join('\n')
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
    const nestedIndent = `${indent}  `
    const transaction = view.state.tr.insertText(`\n${nestedIndent}\n${indent}`, from, to)
    transaction.setSelection(TextSelection.create(transaction.doc, from + nestedIndent.length + 1))
    view.dispatch(transaction)
    return true
  }

  const nextIndent = /[\{\[\(]\s*$/.test(beforeCursor) ? `${indent}  ` : indent
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
    const { $from, empty, from } = view.state.selection
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
    const parentPlugins = this.parent?.() ?? []

    return [
      ...parentPlugins,
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
