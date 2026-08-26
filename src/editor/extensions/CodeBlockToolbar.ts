import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { writeToClipboard } from '../../lib/clipboard'

/**
 * P11-1 read-only affordances: a line-number gutter and a copy button on
 * every code block, plus a per-block word-wrap toggle. P11-3 adds code
 * folding to the same gutter. All of it is widget/inline decorations, the
 * same shape as P7-2's "Open in IDE" button — nothing new stored in the
 * document beyond `codeBlock.wrap` (CodeBlockEditor.ts), which is
 * presentation-only and never reaches the markdown fence. Fold state is
 * the same call: a plain `Set` of positions in this plugin's own state,
 * remapped across edits via `tr.mapping`, never written to the note.
 *
 * Line numbers count source lines, not visual rows: exact whenever a
 * block's wrap toggle is off (the default, and the only state a block with
 * a horizontal scrollbar can be in), and approximate once wrapping is on —
 * the same simplification most lightweight editors accept rather than
 * measuring real layout per line.
 */

const codeBlockToolbarKey = new PluginKey<Set<number>>('codeBlockToolbar')

interface CodeLine {
  /** Offset of this line's first character within the block's own text. */
  start: number
  /** Offset of this line's last character within the block's own text. */
  end: number
  /** Leading whitespace count, or `Infinity` for a blank line — a blank
   *  line never starts a fold and never breaks one open early; it only
   *  ends a fold if nothing deeper follows it. */
  indent: number
}

/** Splits a code block's raw text into per-line offsets and indent depth. */
export function splitLines(text: string): CodeLine[] {
  const lines: CodeLine[] = []
  let offset = 0
  for (const raw of text.split('\n')) {
    const blank = raw.trim().length === 0
    const indent = blank ? Infinity : (raw.match(/^[\t ]*/)?.[0].length ?? 0)
    lines.push({ start: offset, end: offset + raw.length, indent })
    offset += raw.length + 1
  }
  return lines
}

/**
 * The last line index folded into `startIndex`'s region, or `null` if
 * `startIndex` isn't a valid fold start — i.e. its next non-blank line
 * isn't indented deeper than it. Trailing blank lines inside a candidate
 * region are only kept if a further, still-deeper line follows them; a
 * fold never ends on a dangling blank line.
 */
export function foldEndIndex(lines: CodeLine[], startIndex: number): number | null {
  const base = lines[startIndex]?.indent
  if (base === undefined || base === Infinity) return null

  let end = startIndex
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    // Non-null: `i < lines.length` is the loop's own bound.
    const indent = lines[i]!.indent
    if (indent === Infinity) continue
    if (indent > base) {
      end = i
      continue
    }
    break
  }
  return end > startIndex ? end : null
}

// One marker per source line, not one box for the whole gutter: an
// `inline-block` with a matching negative left margin nets zero width in
// the text flow, so each number rides along in the *same* line box as its
// own line's first character — structurally impossible to drift out of
// alignment with it, unlike a separately-positioned column that only
// *looks* lined up if its own font metrics happen to match the code's.
function lineNumberMarker(n: number, foldable: boolean, folded: boolean, foldTogglePos: number | null): HTMLElement {
  const marker = document.createElement('span')
  marker.className = `code-line-number${foldable ? ' foldable' : ''}${folded ? ' folded' : ''}`
  marker.contentEditable = 'false'
  marker.textContent = String(n)
  if (foldTogglePos !== null) {
    marker.setAttribute('data-fold-pos', String(foldTogglePos))
    marker.title = folded ? 'Unfold' : 'Fold'
  }
  return marker
}

function foldPlaceholder(hiddenLineCount: number, foldTogglePos: number): HTMLElement {
  const span = document.createElement('span')
  span.className = 'code-fold-placeholder'
  span.contentEditable = 'false'
  span.setAttribute('data-fold-pos', String(foldTogglePos))
  span.textContent = `⋯ ${hiddenLineCount} line${hiddenLineCount === 1 ? '' : 's'}`
  span.title = 'Unfold'
  return span
}

function codeBlockDecorations(node: ProseMirrorNode, pos: number, folded: Set<number>): Decoration[] {
  const lines = splitLines(node.textContent)
  const contentStart = pos + 1
  const decorations: Decoration[] = []

  for (let i = 0; i < lines.length; i += 1) {
    // Non-null: `i < lines.length` is the loop's own bound.
    const line = lines[i]!
    const lineNumber = i + 1
    const linePos = contentStart + line.start
    const end = foldEndIndex(lines, i)
    const isFoldable = end !== null
    const isFolded = isFoldable && folded.has(linePos)

    // `lineNumber`/`hiddenCount` snapshot `i`/`end` into their own `const`s:
    // `i` is mutated a few lines below (`i = end`) to skip past hidden
    // lines, and a widget factory only runs later, when ProseMirror
    // actually builds the DOM — by then a closure reading `i` directly
    // would see this same iteration's *final* value, not the one at the
    // point the widget was conceptually created.
    decorations.push(
      Decoration.widget(linePos, () => lineNumberMarker(lineNumber, isFoldable, isFolded, isFoldable ? linePos : null), {
        side: -1,
        ignoreSelection: true,
      }),
    )

    if (isFolded && end !== null) {
      const hiddenCount = end - i
      const hideFrom = contentStart + line.end
      // Non-null: `end` came from `foldEndIndex`, always a valid index
      // into `lines`; `end + 1 < lines.length` guards the sibling lookup.
      const hideToOffset = end + 1 < lines.length ? lines[end + 1]!.start : lines[end]!.end
      const hideTo = contentStart + hideToOffset

      decorations.push(
        Decoration.inline(hideFrom, hideTo, { class: 'code-fold-hidden' }),
        Decoration.widget(hideFrom, () => foldPlaceholder(hiddenCount, linePos), { side: 1, ignoreSelection: true }),
      )

      i = end
    }
  }

  return decorations
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

function decorate(state: EditorState, folded: Set<number>): DecorationSet {
  const decorations: Decoration[] = []

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true

    decorations.push(
      ...codeBlockDecorations(node, pos, folded),
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
          init: () => new Set<number>(),
          apply: (tr, folded) => {
            const toggle = tr.getMeta(codeBlockToolbarKey) as number | undefined
            if (typeof toggle === 'number') {
              const next = new Set(folded)
              if (next.has(toggle)) next.delete(toggle)
              else next.add(toggle)
              return next
            }
            if (!tr.docChanged || folded.size === 0) return folded
            const mapped = new Set<number>()
            folded.forEach((pos) => mapped.add(tr.mapping.map(pos)))
            return mapped
          },
        },
        view(view: EditorView) {
          const onClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null
            const foldTarget = target?.closest?.('[data-fold-pos]')
            if (foldTarget instanceof HTMLElement) {
              const foldPos = Number(foldTarget.getAttribute('data-fold-pos'))
              if (Number.isInteger(foldPos)) {
                event.preventDefault()
                view.dispatch(view.state.tr.setMeta(codeBlockToolbarKey, foldPos))
              }
              return
            }

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
            const folded = codeBlockToolbarKey.getState(state) ?? new Set<number>()
            return decorate(state, folded)
          },
        },
      }),
    ]
  },
})
