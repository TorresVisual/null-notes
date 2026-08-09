import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import DragHandle from '@tiptap/extension-drag-handle-react'
import { NodeSelection } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { isNodeRangeSelection } from '@tiptap/extension-node-range'
import { GripVertical, Trash2, Copy } from 'lucide-react'

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

  const { selection } = editor.state
  const isRange = isNodeRangeSelection(selection)
  const isSingle = selection instanceof NodeSelection

  return (
    <DragHandle editor={editor} onNodeChange={handleNodeChange} nested={false}>
      <button
        ref={gripRef}
        type="button"
        className="block-handle-grip"
        aria-label="Block actions"
        onClick={openMenu}
      >
        <GripVertical size={14} />
      </button>
      {menuOpen && (isSingle || isRange) && (
        <BlockHandleMenu
          anchor={gripRef.current}
          showDuplicate={isSingle}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onClose={closeMenu}
        />
      )}
    </DragHandle>
  )
}

interface BlockHandleMenuProps {
  anchor: HTMLElement | null
  showDuplicate: boolean
  onDelete: () => void
  onDuplicate: () => void
  onClose: () => void
}

function BlockHandleMenu({ anchor, showDuplicate, onDelete, onDuplicate, onClose }: BlockHandleMenuProps) {
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
      {showDuplicate && (
        <button type="button" className="block-handle-menu-item" onClick={onDuplicate}>
          <Copy size={13} /> Duplicate
        </button>
      )}
      <button type="button" className="block-handle-menu-item danger" onClick={onDelete}>
        <Trash2 size={13} /> Delete
      </button>
    </div>,
    document.body,
  )
}
