import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import Placeholder from '@tiptap/extension-placeholder'

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
]
