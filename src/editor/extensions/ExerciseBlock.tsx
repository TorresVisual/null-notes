import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import type { Exercise } from '../../pdf/types'

function ExerciseBlockView({ node }: ReactNodeViewProps) {
  const ex = node.attrs['exercise'] as Exercise | null
  if (!ex) return null
  return (
    <div className="exercise-block">
      <h2>{ex.title}</h2>
      {ex.contentBlocks.map((b, i) => (
        <p key={i}>{b.isEquation && b.latex ? `$$${b.latex}$$` : b.text}</p>
      ))}
      <h3>Solution</h3>
    </div>
  )
}

export const ExerciseBlock = Node.create({
  name: 'exerciseBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      exercise: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="exercise-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'exercise-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ExerciseBlockView)
  },
})
