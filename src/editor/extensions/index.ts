import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import Placeholder from '@tiptap/extension-placeholder'
import { InkBlock } from './InkBlock'
import { ExerciseBlock } from './ExerciseBlock'

export const coreExtensions = [
  StarterKit,
  Markdown.configure({
    html: false,
    transformPastedText: true,
    transformCopiedText: true,
  }),
  Placeholder.configure({
    placeholder: 'Start writing…',
  }),
  InkBlock,
  ExerciseBlock,
]
