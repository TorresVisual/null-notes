import { HorizontalRule } from '@tiptap/extension-horizontal-rule'
import { InputRule } from '@tiptap/core'
import type { Command } from '@tiptap/core'
import { liftListItem } from '@tiptap/pm/schema-list'
import type { Selection, Transaction } from '@tiptap/pm/state'

function isInListItem(selection: Selection, itemType: ReturnType<Selection['$from']['node']>['type']): boolean {
  const { $from } = selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type === itemType) return true
  }
  return false
}

// listItem's content is `paragraph block*`, so a horizontalRule inserted
// while the cursor is inside one nests there instead of splitting the list —
// every item typed afterward stays part of the same orderedList node, and its
// numbering carries straight through the divider. Splitting the list out from
// under the cursor first (the same steps Enter-twice does one at a time) means
// what follows belongs to a fresh list, so numbering restarts on the far side
// the way it would between any two separate lists — looped, since a nested
// list (a sub-exercise under a numbered heading, say) is more than one level
// to climb out of, and a single pass only clears the innermost one.
const insertDivider: Command = ({ state, dispatch, tr, commands }) => {
  const itemType = state.schema.nodes.listItem!
  const hrType = state.schema.nodes.horizontalRule!

  if (!isInListItem(state.selection, itemType)) {
    tr.replaceSelectionWith(hrType.create())
    if (dispatch) dispatch(tr)
    return true
  }

  // TipTap's splitListItem refuses to split an already-clean, already-empty
  // block one level in from a *non*-nested item — the exact shape the second
  // pass of this loop produces after peeling the first level off a
  // genuinely multi-level nested list. Rather than fail the whole command
  // over an edge case that deep, stop climbing and insert the divider at
  // however far out we got — still better than the pre-fix nesting bug.
  let guard = 0
  while (isInListItem(tr.selection, itemType) && guard < 20) {
    guard += 1
    if (!commands.splitListItem('listItem')) break

    // `state` here is TipTap's chainable-state shim, whose `.tr` getter
    // returns the very same shared `tr` we're building — running
    // liftListItem straight against it would replay its steps onto the
    // transaction it just read them from. `state.apply` is bound to the
    // real underlying EditorState, so this produces a genuinely independent
    // state reflecting the split, and liftListItem's own transaction can be
    // replayed safely.
    const afterSplit = state.apply(tr)

    let liftedTr: Transaction | null = null
    const liftOk = liftListItem(itemType)(afterSplit, (t) => {
      liftedTr = t
    })
    if (!liftOk || !liftedTr) break
    ;(liftedTr as Transaction).steps.forEach((step) => tr.step(step))

    // `commands.splitListItem` on the next pass reads `state.selection`
    // directly rather than `state.tr` — accessing `.tr` is what syncs the
    // chainable shim's cache, so without this it would keep computing
    // against the pre-lift selection.
    void state.tr
  }

  const { $from: $pos } = tr.selection
  const paragraph = $pos.parent
  const hr = hrType.create()
  let hrPos: number
  if (paragraph.content.size === 0) {
    hrPos = $pos.before()
    tr.replaceWith(hrPos, hrPos + paragraph.nodeSize, hr)
  } else {
    hrPos = $pos.after()
    tr.insert(hrPos, hr)
  }

  // Splitting a list mid-way copies the original list's own attrs onto both
  // halves — including `start`, which is how "Aufgabe 3" keeps its own
  // number instead of the list renumbering it. That's right for the half
  // before the divider, but the whole point here is that the half after
  // does *not* keep counting from wherever the original list happened to
  // start.
  const afterHr = tr.doc.nodeAt(hrPos + hr.nodeSize)
  if (afterHr && afterHr.type.name === 'orderedList' && afterHr.attrs['start'] !== 1) {
    tr.setNodeMarkup(hrPos + hr.nodeSize, undefined, { ...afterHr.attrs, start: 1 })
  }

  if (dispatch) dispatch(tr)
  return true
}

export const Divider = HorizontalRule.extend({
  addCommands() {
    return {
      setHorizontalRule: () => insertDivider,
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^(?:---|—-|___\s|\*\*\*\s)$/,
        handler: ({ chain, range }) => {
          chain().deleteRange(range).setHorizontalRule().run()
        },
      }),
    ]
  },
})
