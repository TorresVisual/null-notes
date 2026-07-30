import { useEffect, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { api } from '../../lib/tauri'

interface NoteImageAttrs {
  src: string
  alt: string | null
  title: string | null
  width: number | null
  height: number | null
}

function isExternal(src: string): boolean {
  return /^(https?:|data:)/.test(src)
}

// Sidecar directories are named after the note, so they routinely contain
// spaces ("Lecture 7.assets/") — and a bare space ends a Markdown link
// destination, which would make the image stop parsing on the next reload.
//
// The attribute therefore holds the raw filesystem path and encoding happens
// only at the Markdown boundary: encode on serialize, decode on parse. Storing
// the encoded form instead would need an idempotent encoder, and encodeURI is
// not one — it escapes "%" too, so each save turns %20 into %2520.
export function encodeSrc(src: string): string {
  return encodeURI(src)
}

// A literal "%" in a filename is not a valid escape sequence and makes
// decodeURI throw, which would take the whole note view down over a file
// called "100%.png".
export function decodeSrc(src: string): string {
  try {
    return decodeURI(src)
  } catch {
    return src
  }
}

function NoteImageView({ node, editor }: ReactNodeViewProps) {
  const { src, alt, title } = node.attrs as unknown as NoteImageAttrs
  const notePath = editor.storage.noteContext.notePath
  const [resolved, setResolved] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setResolved(null)
    setFailed(false)
    if (!src) return
    if (isExternal(src)) {
      setResolved(src)
      return
    }
    api.assets
      .read(notePath, src)
      .then((base64) => {
        if (!cancelled) setResolved(`data:image;base64,${base64}`)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [src, notePath])

  return (
    <NodeViewWrapper as="span" className="note-image">
      {resolved && <img src={resolved} alt={alt ?? ''} title={title ?? undefined} />}
      {/* Same posture as an unresolved wiki-link: say the target is missing
          rather than rendering a broken box the user can't interpret. */}
      {failed && <span className="note-image-missing">Missing image: {src}</span>}
    </NodeViewWrapper>
  )
}

function imageFilesFrom(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((file) => file.type.startsWith('image/'))
}

// ProseMirror handlers have to answer synchronously, so the write is kicked
// off and the event claimed immediately; the node is inserted when it lands.
function storeAndInsert(editor: Editor, files: File[], at: number | null): void {
  const notePath = editor.storage.noteContext.notePath
  if (!notePath) return

  void (async () => {
    for (const file of files) {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
      const src = await api.assets.write(notePath, file.type, bytes)
      const content = { type: 'image', attrs: { src, alt: file.name, title: null } }
      if (at === null) editor.commands.insertContent(content)
      else editor.commands.insertContentAt(at, content)
    }
  })()
}

export const NoteImage = Node.create({
  name: 'image',
  inline: true,
  group: 'inline',
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => decodeSrc(element.getAttribute('src') ?? ''),
      },
      alt: { default: null },
      title: { default: null },
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const w = element.getAttribute('width')
          return w ? parseInt(w, 10) : null
        },
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const h = element.getAttribute('height')
          return h ? parseInt(h, 10) : null
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'img[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteImageView)
  },

  addProseMirrorPlugins() {
    const { editor } = this

    return [
      new Plugin({
        props: {
          handlePaste: (_view: EditorView, event: ClipboardEvent) => {
            const files = imageFilesFrom(event.clipboardData?.files)
            if (!files.length) return false
            storeAndInsert(editor, files, null)
            return true
          },
          handleDrop: (view: EditorView, event: DragEvent, _slice, moved: boolean) => {
            if (moved) return false
            const files = imageFilesFrom(event.dataTransfer?.files)
            if (!files.length) return false
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
            storeAndInsert(editor, files, at?.pos ?? null)
            return true
          },
        },
      }),
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: NoteImageAttrs }) {
          const { src, alt, title, width, height } = node.attrs
          const typed = state as unknown as {
            esc: (text: string) => string
            write: (text: string) => void
          }
          // When explicit dimensions are set, emit a raw HTML <img> tag so the
          // width/height survive the round-trip (Markdown image syntax has no
          // dimension fields).
          if (width !== null || height !== null) {
            const encodedSrc = encodeSrc(src)
            const attrs = [`src="${encodedSrc}"`]
            if (alt) attrs.push(`alt="${alt.replace(/"/g, '&quot;')}"`)
            if (title) attrs.push(`title="${title.replace(/"/g, '&quot;')}"`)
            if (width !== null) attrs.push(`width="${width}"`)
            if (height !== null) attrs.push(`height="${height}"`)
            typed.write(`<img ${attrs.join(' ')}>`)
            return
          }
          const suffix = title ? ` "${title.replace(/"/g, '\\"')}"` : ''
          const destination = encodeSrc(src).replace(/[()]/g, '\\$&')
          typed.write(`![${typed.esc(alt ?? '')}](${destination}${suffix})`)
        },
      },
    }
  },
})
