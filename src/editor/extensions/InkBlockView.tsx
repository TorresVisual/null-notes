import { NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { InkPreview } from './InkPreview'

interface InkBlockAttrs {
  src: string
  width: number
  height: number
}

// Every React node view has to render a `NodeViewWrapper` at its root:
// `ReactNodeViewRenderer` reads the wrapper's element out of the rendered
// output and throws "Please use the NodeViewWrapper component for your node
// view" from its own `get dom()` without one. That throw escapes
// `EditorView.updateState`, so it does not merely break the block — it aborts
// whatever transaction created it, which is how one bad ink block could take
// a whole "Split Into Tasks" rewrite down with it.
export function InkBlockView({ node, editor }: ReactNodeViewProps) {
  const { src, width, height } = node.attrs as unknown as InkBlockAttrs
  // A wrapper even with nothing in it — returning null renders no wrapper.
  if (!src) return <NodeViewWrapper className="ink-block" />
  return (
    <NodeViewWrapper className="ink-block">
      <InkPreview src={src} width={width} height={height} editable={editor.isEditable} />
    </NodeViewWrapper>
  )
}
