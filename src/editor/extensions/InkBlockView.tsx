import { useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { InkCanvas } from '../../ink/InkCanvas'
import { InkPreview } from './InkPreview'

interface InkBlockAttrs {
  src: string
  width: number
  height: number
  inline: boolean
}

// Every React node view has to render a `NodeViewWrapper` at its root:
// `ReactNodeViewRenderer` reads the wrapper's element out of the rendered
// output and throws "Please use the NodeViewWrapper component for your node
// view" from its own `get dom()` without one. That throw escapes
// `EditorView.updateState`, so it does not merely break the block — it aborts
// whatever transaction created it, which is how one bad ink block could take
// a whole "Split Into Tasks" rewrite down with it.
export function InkBlockView({ node, editor }: ReactNodeViewProps) {
  // Zoom is per block and lives only in the view — the file keeps unscaled
  // coordinates, so reopening a note never inherits someone's zoom level.
  const [zoom, setZoom] = useState(1)
  const { src, width, height, inline } = node.attrs as unknown as InkBlockAttrs
  // A wrapper even with nothing in it — returning null renders no wrapper.
  if (!src) return <NodeViewWrapper className="ink-block" />
  return (
    <NodeViewWrapper className="ink-block">
      {inline ? (
        <InkCanvas
          svgPath={src}
          width={width}
          height={height}
          zoom={zoom}
          onZoomChange={setZoom}
          autoGrow
        />
      ) : (
        <InkPreview src={src} width={width} height={height} editable={editor.isEditable} />
      )}
    </NodeViewWrapper>
  )
}
