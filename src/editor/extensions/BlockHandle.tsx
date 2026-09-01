import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import DragHandle from '@tiptap/extension-drag-handle-react'
import { NodeSelection } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { isNodeRangeSelection } from '@tiptap/extension-node-range'
import { GripVertical, Trash2, Copy, ChevronUp, ChevronDown, RefreshCw } from 'lucide-react'

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

  const handleNodeChange = useCallback(
    ({ pos, node }: { pos: number; node: ProseMirrorNode | null; editor: Editor }) => {
      setHoveredPos(node ? pos : null)
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

  return (
    <DragHandle
      editor={editor}
      onNodeChange={handleNodeChange}
      nested={false}
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
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onMoveUp={() => handleMove('up')}
          onMoveDown={() => handleMove('down')}
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
  onDelete: () => void
  onDuplicate: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onConvert: (target: ConvertTarget) => void
  onClose: () => void
}

function BlockHandleMenu({
  anchor,
  showDuplicate,
  canMoveUp,
  canMoveDown,
  convertTarget,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
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
