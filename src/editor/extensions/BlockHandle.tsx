import { useCallback, useState } from 'react'
import type { Editor } from '@tiptap/react'
import DragHandle from '@tiptap/extension-drag-handle-react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { GripVertical } from 'lucide-react'

interface BlockHandleProps {
  editor: Editor
}

export function BlockHandle({ editor }: BlockHandleProps) {
  const [hoveredPos, setHoveredPos] = useState<number | null>(null)

  const handleNodeChange = useCallback(
    ({ pos, node }: { pos: number; node: ProseMirrorNode | null; editor: Editor }) => {
      setHoveredPos(node ? pos : null)
    },
    [],
  )

  function selectHovered() {
    if (hoveredPos === null) return
    editor.commands.setNodeSelection(hoveredPos)
  }

  return (
    <DragHandle editor={editor} onNodeChange={handleNodeChange} nested={false}>
      <button type="button" className="block-handle-grip" aria-label="Block actions" onClick={selectHovered}>
        <GripVertical size={14} />
      </button>
    </DragHandle>
  )
}
