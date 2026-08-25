import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

/**
 * P11-1 read-only affordances: a line-number gutter and a copy button on
 * every code block, plus a per-block word-wrap toggle. All three are widget
 * decorations, the same shape as P7-2's "Open in IDE" button — nothing new
 * stored in the document beyond `codeBlock.wrap` (CodeBlockEditor.ts),
 * which is presentation-only and never reaches the markdown fence.
 *
 * Line numbers count source lines, not visual rows: exact whenever a
 * block's wrap toggle is off (the default, and the only state a block with
 * a horizontal scrollbar can be in), and approximate once wrapping is on —
 * the same simplification most lightweight editors accept rather than
 * measuring real layout per line.
 */

const codeBlockToolbarKey = new PluginKey('codeBlockToolbar')

function lineNumberGutter(node: ProseMirrorNode): HTMLElement {
  const gutter = document.createElement('div')
  gutter.className = 'code-line-numbers'
  gutter.contentEditable = 'false'
  const count = node.textContent.split('\n').length
  const numbers: string[] = []
  for (let i = 1; i <= count; i += 1) numbers.push(String(i))
  gutter.textContent = numbers.join('\n')
  return gutter
}

function blockActions(pos: number, wrap: boolean): HTMLElement {
  const container = document.createElement('div')
  container.className = 'code-block-actions'
  container.contentEditable = 'false'
  container.setAttribute('data-pos', String(pos))

  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'code-block-copy'
  copy.dataset['action'] = 'copy'
  copy.title = 'Copy code'
  copy.textContent = 'Copy'
  container.appendChild(copy)

  const wrapToggle = document.createElement('button')
  wrapToggle.type = 'button'
  wrapToggle.className = `code-block-wrap-toggle${wrap ? ' active' : ''}`
  wrapToggle.dataset['action'] = 'wrap'
  wrapToggle.setAttribute('aria-pressed', wrap ? 'true' : 'false')
  wrapToggle.title = wrap ? 'Disable word wrap' : 'Enable word wrap'
  wrapToggle.textContent = 'Wrap'
  container.appendChild(wrapToggle)

  return container
}

async function writeToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // WebView2 can reject an unfocused/background write; fall through.
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

function decorate(state: EditorState): DecorationSet {
  const decorations: Decoration[] = []

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true

    decorations.push(
      Decoration.widget(pos + 1, () => lineNumberGutter(node), { side: -1, ignoreSelection: true }),
      Decoration.widget(pos + 1, () => blockActions(pos, node.attrs['wrap'] === true), {
        side: -1,
        ignoreSelection: true,
      }),
    )
    return false
  })

  return DecorationSet.create(state.doc, decorations)
}

function showCopiedFeedback(button: HTMLElement) {
  const original = button.textContent
  button.textContent = 'Copied'
  button.classList.add('copied')
  setTimeout(() => {
    button.textContent = original
    button.classList.remove('copied')
  }, 1200)
}

export const CodeBlockToolbar = Extension.create({
  name: 'codeBlockToolbar',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeBlockToolbarKey,
        state: {
          init: (_, state) => decorate(state),
          apply: (tr, old, _oldState, newState) => (tr.docChanged ? decorate(newState) : old),
        },
        view(view: EditorView) {
          const onClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null
            const button = target?.closest?.('.code-block-copy, .code-block-wrap-toggle')
            if (!(button instanceof HTMLElement)) return

            const container = button.closest('.code-block-actions')
            const pos = Number(container?.getAttribute('data-pos'))
            if (!Number.isInteger(pos)) return
            const node = view.state.doc.nodeAt(pos)
            if (!node) return

            event.preventDefault()

            if (button.dataset['action'] === 'copy') {
              void writeToClipboard(node.textContent).then(() => showCopiedFeedback(button))
              return
            }

            view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, wrap: !node.attrs['wrap'] }))
          }
          view.dom.addEventListener('click', onClick)

          return {
            destroy: () => view.dom.removeEventListener('click', onClick),
          }
        },
        props: {
          decorations(state) {
            return codeBlockToolbarKey.getState(state) as DecorationSet
          },
        },
      }),
    ]
  },
})
