import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import DragHandle from '@tiptap/extension-drag-handle-react'
import type { NestedOptions } from '@tiptap/extension-drag-handle'
import { NodeSelection } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { isNodeRangeSelection } from '@tiptap/extension-node-range'
import { GripVertical, Trash2, Copy, ChevronUp, ChevronDown, RefreshCw, ListChecks } from 'lucide-react'

interface BlockHandleProps {
  editor: Editor
}

function duplicateSelectedNode(editor: Editor): boolean {
  const { selection } = editor.state
  if (!(selection instanceof NodeSelection)) return false
  const json = selection.node.toJSON()
  const insertPos = selection.to
  return editor.chain().focus().insertContentAt(insertPos, json).setNodeSelection(insertPos).run()
}

/**
 * Swaps the selected block with its previous/next sibling at the same
 * depth — a single atomic `replaceWith` over both nodes' combined range,
 * not a delete-then-insert, so there's no intermediate position to remap
 * across two separate transform steps. Move-only: dragging (already
 * shipped via `DragHandle`) covers arbitrary repositioning; these buttons
 * are the precise, keyboard-reachable alternative for "one step up/down."
 */
export function moveSelectedNode(editor: Editor, direction: 'up' | 'down'): boolean {
  const { state } = editor
  const { selection } = state
  if (!(selection instanceof NodeSelection)) return false

  const $pos = selection.$from
  const parent = $pos.parent
  const index = $pos.index()
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= parent.childCount) return false

  const lo = Math.min(index, targetIndex)
  let rangeStart = $pos.start()
  for (let i = 0; i < lo; i += 1) rangeStart += parent.child(i).nodeSize
  const first = parent.child(lo)
  const second = parent.child(lo + 1)
  const rangeEnd = rangeStart + first.nodeSize + second.nodeSize

  const tr = state.tr.replaceWith(rangeStart, rangeEnd, [second, first])
  const movedNodePos = direction === 'up' ? rangeStart : rangeStart + second.nodeSize
  tr.setSelection(NodeSelection.create(tr.doc, movedNodePos))
  tr.scrollIntoView()
  editor.view.dispatch(tr)
  return true
}

/**
 * Moves checked task items to the bottom of the selected task list,
 * preserving relative order within each group — a manual "focus the next
 * tasks" action, not an auto-sort on check. Nested sub-lists travel with
 * their parent item untouched; only direct children get reordered.
 */
export function reorderTaskList(editor: Editor): boolean {
  const { state } = editor
  const { selection } = state
  if (!(selection instanceof NodeSelection)) return false
  const node = selection.node
  if (node.type.name !== 'taskList') return false

  const children: ProseMirrorNode[] = []
  node.forEach((child) => children.push(child))
  const reordered = [
    ...children.filter((c) => !c.attrs['checked']),
    ...children.filter((c) => c.attrs['checked']),
  ]
  if (reordered.every((c, i) => c === children[i])) return false

  const { from, to } = selection
  const tr = state.tr.replaceWith(from, to, node.type.create(node.attrs, reordered))
  tr.setSelection(NodeSelection.create(tr.doc, from))
  tr.scrollIntoView()
  editor.view.dispatch(tr)
  return true
}

/** Display concern only, mirroring `canMoveSelectedNode`: is there a
 *  checked item followed by an unchecked one for `reorderTaskList` to move? */
function canReorderTaskList(node: ProseMirrorNode | null): boolean {
  if (!node || node.type.name !== 'taskList') return false
  let seenChecked = false
  let out = false
  node.forEach((child) => {
    if (child.attrs['checked']) seenChecked = true
    else if (seenChecked) out = true
  })
  return out
}

export type ConvertTarget =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'blockquote'

export const CONVERT_TARGET_LABELS: Record<ConvertTarget, string> = {
  paragraph: 'Text',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  bulletList: 'Bullet List',
  orderedList: 'Numbered List',
  taskList: 'To-do List',
  blockquote: 'Quote',
}

const CONVERTIBLE_NODE_TYPE_NAMES = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote'])

// Module-level, not inline in JSX: DragHandle re-registers its ProseMirror
// plugin whenever this object's reference changes, and BlockHandle re-renders
// on every editor transaction (it reads editor.state directly). An inline
// literal here was a fresh object every keystroke, so the plugin was being
// torn down and rebuilt continuously — collateral damage included aborting
// any other plugin's in-flight async work (e.g. SlashCommands' suggestion
// menu, which never got to show its items because its fetch kept getting
// cancelled mid-flight).
const DRAG_HANDLE_POSITION_CONFIG = { placement: 'left' } as const

const LIST_CONTAINER_TYPE_NAMES = ['bulletList', 'orderedList', 'taskList']

// Module-level for the same reason as DRAG_HANDLE_POSITION_CONFIG above.
// Non-nested (the library's default) treats an entire list as one
// undifferentiated top-level block: the grip centers on the whole list's
// bounding box, not the hovered row, so a long list (a real checklist, not
// a 2-3 item example) puts the grip screens away from the cursor.
//
// The library's own `allowedContainers` option looks like the fix but isn't:
// it excludes a candidate unless it has an ANCESTOR of an allowed type, so
// the list node itself — whose only ancestor is `doc` — is excluded outright,
// making it impossible to ever select the whole list again (breaks Reorder
// tasks and "Turn into" for lists entirely). `onlyNestedInsideLists` below
// does the equivalent scoping without that self-exclusion: depth-1 (the
// top-level block, whatever type it is, including the list itself) is
// always left alone; only going deeper than that is restricted to inside
// one of these three container types. `defaultRules` stays off for the same
// reason — its `listWrapperDeprioritize` rule excludes the wrapper outright
// too. Left unexcluded and at a shallower depth than its items, the list
// still wins near the left edge (edgeDetection's default), where the grip
// itself sits; hovering more centrally resolves to the individual item.
const NESTED_LIST_DRAG_HANDLE_OPTIONS: NestedOptions = {
  defaultRules: false,
  rules: [
    {
      id: 'excludeListItemContentParagraph',
      evaluate: ({ parent, isFirst }) =>
        isFirst && parent && ['listItem', 'taskItem'].includes(parent.type.name) ? 1000 : 0,
    },
    {
      id: 'onlyNestedInsideLists',
      evaluate: ({ depth, $pos }) =>
        depth > 1 && !LIST_CONTAINER_TYPE_NAMES.includes($pos.node(1).type.name) ? 1000 : 0,
    },
  ],
}

/** Whether "Turn into" should offer anything for this node at all — a
 *  generic type-swap only makes sense for plain text-block types, never
 *  for code blocks, tables, images, ink, diagrams, math, or callouts. */
export function isConvertibleNode(node: ProseMirrorNode): boolean {
  return CONVERTIBLE_NODE_TYPE_NAMES.has(node.type.name)
}

/** The node's own `ConvertTarget` identity, or `null` if it isn't one —
 *  used to leave the current type out of its own "Turn into" list. */
export function currentConvertTarget(node: ProseMirrorNode): ConvertTarget | null {
  switch (node.type.name) {
    case 'paragraph':
      return 'paragraph'
    case 'heading':
      return `heading${node.attrs['level']}` as ConvertTarget
    case 'bulletList':
      return 'bulletList'
    case 'orderedList':
      return 'orderedList'
    case 'taskList':
      return 'taskList'
    case 'blockquote':
      return 'blockquote'
    default:
      return null
  }
}

/** Converts the selected block to `target` via TipTap's own block-type
 *  commands — each already knows how to wrap/lift/set correctly regardless
 *  of what the block currently is. */
export function convertSelectedNode(editor: Editor, target: ConvertTarget): boolean {
  if (!(editor.state.selection instanceof NodeSelection)) return false
  const chain = editor.chain().focus()
  switch (target) {
    case 'paragraph':
      return chain.setParagraph().run()
    case 'heading1':
      return chain.toggleHeading({ level: 1 }).run()
    case 'heading2':
      return chain.toggleHeading({ level: 2 }).run()
    case 'heading3':
      return chain.toggleHeading({ level: 3 }).run()
    case 'bulletList':
      return chain.toggleBulletList().run()
    case 'orderedList':
      return chain.toggleOrderedList().run()
    case 'taskList':
      return chain.toggleTaskList().run()
    case 'blockquote':
      return chain.toggleBlockquote().run()
  }
}

/** Whether a move in `direction` would actually move anything — a sibling
 *  has to exist at the target index. Purely a display concern (enabling/
 *  disabling the button); `moveSelectedNode` re-checks this itself and is
 *  the one place that matters for correctness. */
function canMoveSelectedNode(editor: Editor, direction: 'up' | 'down'): boolean {
  const { selection } = editor.state
  if (!(selection instanceof NodeSelection)) return false
  const $pos = selection.$from
  const targetIndex = direction === 'up' ? $pos.index() - 1 : $pos.index() + 1
  return targetIndex >= 0 && targetIndex < $pos.parent.childCount
}

export function BlockHandle({ editor }: BlockHandleProps) {
  const [hoveredPos, setHoveredPos] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const gripRef = useRef<HTMLButtonElement>(null)
  const lastHoveredPosRef = useRef<number | null>(null)

  // DragHandle renders its `.drag-handle` wrapper as a sibling of the editor
  // DOM, not a descendant — the grip sits flush against, but outside, the
  // editor's own hoverable box. Moving the cursor toward it means crossing
  // that boundary, and the library's own mouseleave guard is supposed to
  // recognize "heading for the grip" and skip hiding — but at the exact
  // crossing pixel, native hit-testing resolves to whatever sits behind the
  // wrapper (this app's `.editor-pane`), not the wrapper itself, so the
  // guard's `relatedTarget` check fails: it hides (visibility + pointer-
  // events: none) *and* reports `onNodeChange(null)`, clearing our own
  // `hoveredPos`, right as the cursor arrives — before a click can land, and
  // even a click that does land finds `openMenu` sees nothing selected.
  // Rather than fight that guard, undo both effects from outside once the
  // cursor is near the grip's own last-known position. A margin, not a
  // strict bounding-box test: the same boundary crossing that triggers the
  // false hide can also (correctly, via edge detection) retarget the grip
  // from a row to its enclosing list right as it happens, so the last-known
  // rect the cursor needs to still be "in" isn't necessarily the one the
  // cursor's own y was originally measured against.
  useEffect(() => {
    const MARGIN_PX = 32
    function onMouseMove(e: MouseEvent) {
      const wrapper = gripRef.current?.closest<HTMLElement>('.drag-handle')
      if (!wrapper || wrapper.style.visibility !== 'hidden') return
      const rect = wrapper.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      if (
        e.clientX < rect.left - MARGIN_PX ||
        e.clientX > rect.right + MARGIN_PX ||
        e.clientY < rect.top - MARGIN_PX ||
        e.clientY > rect.bottom + MARGIN_PX
      ) {
        return
      }
      wrapper.style.visibility = ''
      wrapper.style.pointerEvents = 'auto'
      setHoveredPos(lastHoveredPosRef.current)
    }
    document.addEventListener('mousemove', onMouseMove)
    return () => document.removeEventListener('mousemove', onMouseMove)
  }, [])

  const handleNodeChange = useCallback(
    ({ pos, node }: { pos: number; node: ProseMirrorNode | null; editor: Editor }) => {
      const next = node ? pos : null
      if (next !== null) lastHoveredPosRef.current = next
      setHoveredPos(next)
      setMenuOpen(false)
    },
    [],
  )

  function openMenu() {
    if (hoveredPos === null) return
    editor.commands.setNodeSelection(hoveredPos)
    setMenuOpen(true)
  }

  function closeMenu() {
    setMenuOpen(false)
  }

  function handleDelete() {
    editor.chain().focus().deleteSelection().run()
    closeMenu()
  }

  function handleDuplicate() {
    duplicateSelectedNode(editor)
    closeMenu()
  }

  function handleMove(direction: 'up' | 'down') {
    moveSelectedNode(editor, direction)
    // Stays open: the grip tracks the selection, which moveSelectedNode
    // updates to follow the block, so the menu just repositions with it.
  }

  function handleReorderTasks() {
    reorderTaskList(editor)
    closeMenu()
  }

  function handleConvert(target: ConvertTarget) {
    convertSelectedNode(editor, target)
    closeMenu()
  }

  const { selection } = editor.state
  const isRange = isNodeRangeSelection(selection)
  const isSingle = selection instanceof NodeSelection
  const singleNode = isSingle ? selection.node : null
  const convertTarget = singleNode ? currentConvertTarget(singleNode) : null
  const showConvert = singleNode !== null && isConvertibleNode(singleNode)
  const showReorderTasks = convertTarget === 'taskList'

  return (
    <DragHandle
      editor={editor}
      onNodeChange={handleNodeChange}
      nested={NESTED_LIST_DRAG_HANDLE_OPTIONS}
      // The library's own default ("left-start") top-aligns the handle to
      // the tracked node's bounding box, which only looks centered for a
      // node exactly as tall as the grip. Plain "left" centers it on the
      // cross axis against the node's actual height instead.
      computePositionConfig={DRAG_HANDLE_POSITION_CONFIG}
    >
      <button
        ref={gripRef}
        type="button"
        className="block-handle-grip"
        aria-label="Block actions"
        title="Block actions"
        onClick={openMenu}
      >
        <GripVertical size={14} />
      </button>
      {menuOpen && (isSingle || isRange) && (
        <BlockHandleMenu
          anchor={gripRef.current}
          showDuplicate={isSingle}
          canMoveUp={isSingle && canMoveSelectedNode(editor, 'up')}
          canMoveDown={isSingle && canMoveSelectedNode(editor, 'down')}
          convertTarget={showConvert ? convertTarget : null}
          showReorderTasks={showReorderTasks}
          canReorderTasks={showReorderTasks && canReorderTaskList(singleNode)}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onMoveUp={() => handleMove('up')}
          onMoveDown={() => handleMove('down')}
          onReorderTasks={handleReorderTasks}
          onConvert={handleConvert}
          onClose={closeMenu}
        />
      )}
    </DragHandle>
  )
}

interface BlockHandleMenuProps {
  anchor: HTMLElement | null
  showDuplicate: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  /** The node's own target when it's convertible, else `null` when
   *  "Turn into" shouldn't render at all for this node. */
  convertTarget: ConvertTarget | null
  showReorderTasks: boolean
  canReorderTasks: boolean
  onDelete: () => void
  onDuplicate: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onReorderTasks: () => void
  onConvert: (target: ConvertTarget) => void
  onClose: () => void
}

function BlockHandleMenu({
  anchor,
  showDuplicate,
  canMoveUp,
  canMoveDown,
  convertTarget,
  showReorderTasks,
  canReorderTasks,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onReorderTasks,
  onConvert,
  onClose,
}: BlockHandleMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || anchor?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [anchor, onClose])

  const rect = anchor?.getBoundingClientRect()

  return createPortal(
    <div
      ref={menuRef}
      className="block-handle-menu"
      style={{ position: 'fixed', top: (rect?.bottom ?? 0) + 6, left: rect?.left ?? 0 }}
    >
      <button type="button" className="block-handle-menu-item" onClick={onMoveUp} disabled={!canMoveUp}>
        <ChevronUp size={13} /> Move up
      </button>
      <button type="button" className="block-handle-menu-item" onClick={onMoveDown} disabled={!canMoveDown}>
        <ChevronDown size={13} /> Move down
      </button>
      {showDuplicate && (
        <button type="button" className="block-handle-menu-item" onClick={onDuplicate}>
          <Copy size={13} /> Duplicate
        </button>
      )}
      {showReorderTasks && (
        <button type="button" className="block-handle-menu-item" onClick={onReorderTasks} disabled={!canReorderTasks}>
          <ListChecks size={13} /> Reorder tasks
        </button>
      )}
      {convertTarget && (
        <>
          <div className="block-handle-menu-label">
            <RefreshCw size={12} /> Turn into
          </div>
          {(Object.keys(CONVERT_TARGET_LABELS) as ConvertTarget[])
            .filter((target) => target !== convertTarget)
            .map((target) => (
              <button
                key={target}
                type="button"
                className="block-handle-menu-item block-handle-menu-item-indent"
                onClick={() => onConvert(target)}
              >
                {CONVERT_TARGET_LABELS[target]}
              </button>
            ))}
        </>
      )}
      <button type="button" className="block-handle-menu-item danger" onClick={onDelete}>
        <Trash2 size={13} /> Delete
      </button>
    </div>,
    document.body,
  )
}
