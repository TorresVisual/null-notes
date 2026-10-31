import { Mark } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { applyMarkdownLink } from '../../lib/markdownLink'

export const LINK_SOURCE_PATTERN = /^\[([^\]\n]+)\]\(([^)\n]*)\)$/

interface SourceState {
  focused: boolean
  block: number | null
}

const key = new PluginKey<SourceState>('linkSource')

interface Run {
  id: string
  from: number
  to: number
}

function runsOf(block: ProseMirrorNode, blockPos: number, belongs: (child: ProseMirrorNode) => string | null): Run[] {
  const runs: Run[] = []
  let current: Run | null = null
  block.forEach((child, offset) => {
    const id = child.isText ? belongs(child) : null
    const from = blockPos + 1 + offset
    if (id !== null && current?.id === id && current.to === from) {
      current.to = from + child.nodeSize
    } else {
      if (current) runs.push(current)
      current = id === null ? null : { id, from, to: from + child.nodeSize }
    }
  })
  if (current) runs.push(current)
  return runs
}

// A link is only expanded when `[label](href)` would read back as the same
// link: no formatting inside the label, no title, nothing that ends the syntax.
function expandableLink(child: ProseMirrorNode): string | null {
  const [mark, ...rest] = child.marks
  if (!mark || rest.length || mark.type.name !== 'link') return null
  const { href, title } = mark.attrs as { href: string; title: string | null }
  if (title || /[()\n]/.test(href) || /[\]\n]/.test(child.text ?? '')) return null
  return href
}

function expand(tr: Transaction, blockPos: number): void {
  const block = tr.doc.nodeAt(blockPos)
  if (!block?.isTextblock) return
  const { linkSource } = tr.doc.type.schema.marks
  if (!linkSource) return
  for (const { id: href, from, to } of runsOf(block, blockPos, expandableLink).reverse()) {
    const label = tr.doc.textBetween(from, to)
    tr.replaceWith(from, to, tr.doc.type.schema.text(`[${label}](${href})`, [linkSource.create()]))
  }
}

// Source that no longer reads as a link is left as plain text rather than
// guessed at.
function collapse(tr: Transaction, blockPos: number): void {
  const block = tr.doc.nodeAt(blockPos)
  if (!block?.isTextblock) return
  const { link, linkSource } = tr.doc.type.schema.marks
  if (!link || !linkSource) return
  const runs = runsOf(block, blockPos, (child) => (linkSource.isInSet(child.marks) ? 'source' : null))
  for (const { from, to } of runs.reverse()) {
    const text = tr.doc.textBetween(from, to)
    const linked = LINK_SOURCE_PATTERN.test(text) && applyMarkdownLink(tr, link, to - 1, 1)
    if (!linked) tr.removeMark(from, to, linkSource)
  }
}

function linkSourceMarkIn(node: ProseMirrorNode): boolean {
  return node.marks.some((m) => m.type.name === 'linkSource')
}

function selectedBlock(state: EditorState): number | null {
  const { selection } = state
  if (!(selection instanceof TextSelection)) return null
  const { $head } = selection
  return $head.parent.isTextblock && !$head.parent.type.spec.code ? $head.before() : null
}

/**
 * Putting the caret on a line with links shows them as `[label](href)` so the
 * destination can be edited; leaving the line, or the editor, turns the source
 * back into links. Clicking a link itself opens it and never moves the caret
 * (see `noteLinkClick`), so the line is reached by clicking beside the link or
 * by keyboard.
 */
export const LinkSource = Mark.create({
  name: 'linkSource',

  parseHTML: () => [],

  renderHTML: () => ['span', { class: 'link-source' }, 0],

  addStorage() {
    return { markdown: { serialize: { open: '', close: '', mixable: true }, parse: {} } }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SourceState>({
        key,
        state: {
          init: () => ({ focused: false, block: null }),
          apply(tr, value) {
            const meta = tr.getMeta(key) as Partial<SourceState> | undefined
            return {
              focused: meta?.focused ?? value.focused,
              block: meta && 'block' in meta ? (meta.block ?? null) : value.block === null ? null : tr.mapping.map(value.block),
            }
          },
        },
        props: {
          // A line break inside `[label](href)` would cut the source in two and
          // leave neither half a link, so Enter breaks the line after it instead.
          handleKeyDown(view, event) {
            if (event.key !== 'Enter') return false
            const { selection } = view.state
            if (!selection.empty) return false
            const { $from } = selection
            if (!$from.nodeBefore || !$from.nodeAfter) return false
            if (!linkSourceMarkIn($from.nodeBefore) || !linkSourceMarkIn($from.nodeAfter)) return false
            const end = runsOf($from.parent, $from.start() - 1, (c) => (linkSourceMarkIn(c) ? 'source' : null)).find(
              (run) => run.from <= $from.pos && $from.pos <= run.to,
            )?.to
            if (end !== undefined) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
            return false
          },
          handleDOMEvents: {
            focus: (view) => {
              view.dispatch(view.state.tr.setMeta(key, { focused: true }).setMeta('addToHistory', false))
              return false
            },
            blur: (view) => {
              view.dispatch(view.state.tr.setMeta(key, { focused: false }).setMeta('addToHistory', false))
              return false
            },
          },
        },
        appendTransaction(_trs, _old, state) {
          const { focused, block } = key.getState(state) ?? { focused: false, block: null }
          const target = focused ? selectedBlock(state) : null
          if (target === block) return null

          const tr = state.tr
          if (block !== null) collapse(tr, block)
          const mapped = target === null ? null : tr.mapping.map(target)
          if (mapped !== null) expand(tr, mapped)
          return tr
            .setMeta(key, { block: mapped })
            .setMeta('addToHistory', false)
            .setMeta('preventAutolink', true)
            .setMeta('preventUpdate', true)
        },
      }),
    ]
  },
})
