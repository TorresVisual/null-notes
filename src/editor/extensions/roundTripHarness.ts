import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

export function roundTrip(markdown: string): string {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: coreExtensions, content: markdown })
  const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  const out = storage.markdown.getMarkdown()
  editor.destroy()
  element.remove()
  return out
}
