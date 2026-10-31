import { Extension } from '@tiptap/core'
import type { CommandProps } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Fold/unfold for headings and list items. View-only: the document is never
 * touched, folded content is hidden by a `fold-hidden` node decoration, so
 * the `.md` on disk (and undo history) is unaffected.
 *
 * Plugin state is the start positions of the folded headings/list items,
 * mapped through every transaction. What a fold hides is recomputed from the
 * live document each pass: a heading hides its following siblings up to the
 * next heading of the same or higher level, a list item hides everything
 * after its first child (the nested content).
 *
 * Hidden content stays in the DOM (`display: none`), so native arrow-key
 * navigation steps over it and find still matches it. A caret that ends up
 * inside hidden content (Enter at the end of a folded heading, undo, …)
 * unfolds it again — see `appendTransaction`.
 */

const foldKey = new PluginKey<number[]>('folding')

type FoldMeta =
  | { type: 'toggle'; pos: number }
  | { type: 'foldAll' }
  | { type: 'unfoldAll' }
  | { type: 'unfold'; positions: number[] }

const LIST_ITEMS = new Set(['listItem', 'taskItem'])

interface Range {
  from: number
  to: number
}

function isFoldable(node: ProseMirrorNode, parent: ProseMirrorNode | null, index: number): boolean {
  if (LIST_ITEMS.has(node.type.name)) return node.childCount > 1
  if (node.type.name !== 'heading') return false
  const next = parent?.maybeChild(index + 1)
  return !!next && !(next.type.name === 'heading' && (next.attrs.level as number) <= (node.attrs.level as number))
}

function foldablePositions(doc: ProseMirrorNode): number[] {
  const positions: number[] = []
  doc.descendants((node, pos, parent, index) => {
    if (isFoldable(node, parent, index)) positions.push(pos)
    return node.type.name !== 'heading'
  })
  return positions
}

/** The nodes folded away when the heading/list item at `pos` is folded. */
function hiddenNodes(doc: ProseMirrorNode, pos: number): Range[] {
  const node = doc.nodeAt(pos)
  if (!node) return []

  const ranges: Range[] = []
  if (LIST_ITEMS.has(node.type.name)) {
    let from = pos + 1 + node.child(0).nodeSize
    for (let i = 1; i < node.childCount; i++) {
      const size = node.child(i).nodeSize
      ranges.push({ from, to: from + size })
      from += size
    }
    return ranges
  }

  const $pos = doc.resolve(pos)
  const level = node.attrs.level as number
  let from = pos + node.nodeSize
  for (let i = $pos.index() + 1; i < $pos.parent.childCount; i++) {
    const sibling = $pos.parent.child(i)
    if (sibling.type.name === 'heading' && (sibling.attrs.level as number) <= level) break
    ranges.push({ from, to: from + sibling.nodeSize })
    from += sibling.nodeSize
  }
  return ranges
}

function hides(doc: ProseMirrorNode, foldedPos: number, pos: number): boolean {
  const ranges = hiddenNodes(doc, foldedPos)
  const first = ranges[0]
  const last = ranges[ranges.length - 1]
  return !!first && !!last && pos > first.from && pos < last.to
}

function apply(tr: Transaction, value: number[]): number[] {
  const meta = tr.getMeta(foldKey) as FoldMeta | undefined
  let folded = value
  if (tr.docChanged) {
    folded = []
    for (const pos of value) {
      const mapped = tr.mapping.mapResult(pos, 1)
      const node = tr.doc.nodeAt(mapped.pos)
      if (!mapped.deleted && node && (node.type.name === 'heading' || LIST_ITEMS.has(node.type.name))) folded.push(mapped.pos)
    }
  }
  if (!meta) return folded
  if (meta.type === 'foldAll') return foldablePositions(tr.doc)
  if (meta.type === 'unfoldAll') return []
  if (meta.type === 'unfold') return folded.filter((pos) => !meta.positions.includes(pos))
  return folded.includes(meta.pos) ? folded.filter((pos) => pos !== meta.pos) : [...folded, meta.pos]
}

function decorate(state: EditorState): DecorationSet {
  const folded = foldKey.getState(state) ?? []
  const decorations: Decoration[] = []

  state.doc.descendants((node, pos, parent, index) => {
    if (!isFoldable(node, parent, index)) return node.type.name !== 'heading'
    const collapsed = folded.includes(pos)
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: collapsed ? 'fold-able fold-collapsed' : 'fold-able' }))
    decorations.push(
      Decoration.widget(pos + 1, () => foldToggle(pos, collapsed), {
        side: -1,
        ignoreSelection: true,
        key: `fold-${pos}-${collapsed}`,
      }),
    )
    return node.type.name !== 'heading'
  })

  for (const pos of folded) {
    for (const range of hiddenNodes(state.doc, pos)) {
      decorations.push(Decoration.node(range.from, range.to, { class: 'fold-hidden' }))
    }
  }

  return DecorationSet.create(state.doc, decorations)
}

function foldToggle(pos: number, collapsed: boolean): HTMLElement {
  const toggle = document.createElement('span')
  toggle.className = 'fold-toggle'
  toggle.contentEditable = 'false'
  toggle.setAttribute('data-fold-pos', String(pos))
  toggle.setAttribute('role', 'button')
  toggle.setAttribute('aria-expanded', String(!collapsed))
  toggle.title = collapsed ? 'Unfold' : 'Fold'
  toggle.textContent = '▸'
  return toggle
}

/** Unfolds every fold that hides `pos` or starts exactly at it — call before
 *  scrolling to or highlighting a position that may sit inside folded content. */
export function revealPos(view: EditorView, pos: number): void {
  const { doc } = view.state
  const positions = (foldKey.getState(view.state) ?? []).filter((folded) => folded === pos || hides(doc, folded, pos))
  if (positions.length) view.dispatch(view.state.tr.setMeta(foldKey, { type: 'unfold', positions } satisfies FoldMeta))
}

export const REVEAL_FOLD_EVENT = 'null-notes:reveal-fold'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    folding: {
      foldAll: () => ReturnType
      unfoldAll: () => ReturnType
    }
  }
}

export const Folding = Extension.create({
  name: 'folding',

  addCommands() {
    const dispatchMeta = (meta: FoldMeta) => () => ({ tr, dispatch }: CommandProps) => {
      if (dispatch) tr.setMeta(foldKey, meta)
      return true
    }
    return {
      foldAll: dispatchMeta({ type: 'foldAll' }),
      unfoldAll: dispatchMeta({ type: 'unfoldAll' }),
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<number[]>({
        key: foldKey,
        state: { init: () => [], apply },
        props: {
          decorations: decorate,
          handleDOMEvents: {
            mousedown(view, event) {
              const toggle = (event.target as HTMLElement | null)?.closest<HTMLElement>('.fold-toggle')
              if (!toggle) return false
              event.preventDefault()
              const pos = Number(toggle.dataset.foldPos)
              view.dispatch(view.state.tr.setMeta(foldKey, { type: 'toggle', pos } satisfies FoldMeta))
              return true
            },
            // Lets the Outline reveal a heading by DOM element without
            // needing a reference to the editor.
            [REVEAL_FOLD_EVENT](view, event) {
              const target = event.target
              if (!(target instanceof Node)) return false
              const $pos = view.state.doc.resolve(view.posAtDOM(target, 0))
              revealPos(view, $pos.depth > 0 ? $pos.before($pos.depth) : $pos.pos)
              return true
            },
          },
        },
        appendTransaction(transactions, _old, state) {
          const folded = foldKey.getState(state)
          const { selection } = state
          if (!folded?.length || !selection.empty) return null

          const covering = folded.filter((pos) => hides(state.doc, pos, selection.from))
          if (!covering.length) return null

          const foldedJustNow = transactions.some((tr) => {
            const type = (tr.getMeta(foldKey) as FoldMeta | undefined)?.type
            return type === 'toggle' || type === 'foldAll'
          })
          if (!foldedJustNow) return state.tr.setMeta(foldKey, { type: 'unfold', positions: covering } satisfies FoldMeta)

          const outermost = Math.min(...covering)
          const firstHidden = hiddenNodes(state.doc, outermost)[0]
          if (!firstHidden) return null
          return state.tr.setSelection(TextSelection.near(state.doc.resolve(firstHidden.from), -1))
        },
      }),
    ]
  },
})
