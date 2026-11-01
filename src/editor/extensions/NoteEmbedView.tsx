import { lazy, Suspense, useContext, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useEditor, EditorContent, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useNotesStore } from '../../store/notes'
import { useWorkspaceStore } from '../../store/workspace'
import { isBasePath } from '../../lib/canvasPath'
import { folderName } from '../../lib/pathPrefix'
import { useEmbedSource } from '../../hooks/useEmbedSource'
import { embedBody } from '../../lib/embedSyntax'
import { setPendingHighlight } from '../../lib/pendingHighlight'
import { wikiLinkText } from '../../lib/wikiLinkSyntax'
import { extensionsFor } from './index'
import { EmbedChainContext, MAX_EMBED_DEPTH } from './EmbedChainContext'

const BasePane = lazy(() => import('../../components/BasePane').then((m) => ({ default: m.BasePane })))

// Events a ProseMirror view would otherwise turn into selection changes, key
// commands or its own drag handling while the user works inside the base.
const CONTAINED_EVENTS = ['mousedown', 'click', 'keydown', 'keyup', 'keypress', 'dragstart', 'dragover', 'drop', 'paste']

interface EmbedAttrs {
  title: string
  heading: string
  label: string
}

// These mutate the document, run code, or act on the active tab, so inside a
// read-only excerpt they would edit the source or act on the host instead.
const INTERACTIVE_EXTENSIONS = new Set(['codeBlockRun', 'codeBlockToolbar', 'codeBlockOpenInIde', 'tableControls'])

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <NodeViewWrapper className="note-embed note-embed-missing" spellCheck={false}>
      {children}
    </NodeViewWrapper>
  )
}

function EmbedBody({ markdown, path }: { markdown: string; path: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const editor = useEditor({
    extensions: extensionsFor(path).filter((extension) => !INTERACTIVE_EXTENSIONS.has(extension.name)),
    content: markdown,
    editable: false,
  })

  // The nested editor's DOM sits inside the host's, and several plugins attach
  // native click listeners to `view.dom` that apply a clicked position to their
  // own document. Native, not React: React's onClick runs after the host's
  // listeners have already fired.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const stop = (e: Event) => e.stopPropagation()
    el.addEventListener('click', stop)
    return () => el.removeEventListener('click', stop)
  }, [])

  return (
    <div className="note-embed-body" ref={ref}>
      <EditorContent editor={editor} />
    </div>
  )
}

function BaseEmbed({ title, hostPath }: { title: string; hostPath: string }) {
  const canvases = useNotesStore((s) => s.canvases)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const ref = useRef<HTMLDivElement>(null)
  const path = canvases.find((p) => isBasePath(p) && folderName(p).toLowerCase() === title.toLowerCase())

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const stop = (e: Event) => e.stopPropagation()
    CONTAINED_EVENTS.forEach((type) => el.addEventListener(type, stop))
    return () => CONTAINED_EVENTS.forEach((type) => el.removeEventListener(type, stop))
  }, [path])

  if (!path) return <Placeholder>{`Note "${title}" not found`}</Placeholder>
  return (
    <NodeViewWrapper className="note-embed note-embed-base" spellCheck={false}>
      <button type="button" className="note-embed-header" contentEditable={false} onClick={() => openTab(path)}>
        {title}
      </button>
      <div ref={ref} contentEditable={false}>
        <Suspense fallback={null}>
          <BasePane key={path} path={path} embedded thisPath={hostPath} />
        </Suspense>
      </div>
    </NodeViewWrapper>
  )
}

export function NoteEmbedView({ node, editor }: ReactNodeViewProps) {
  const { title, heading, label } = node.attrs as unknown as EmbedAttrs
  const notes = useNotesStore((s) => s.notes)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const chain = [...useContext(EmbedChainContext), editor.storage.noteContext.notePath]

  const isBase = /\.base$/i.test(title)
  const target = isBase ? undefined : notes.find((n) => n.title.toLowerCase() === title.toLowerCase())
  const circular = target !== undefined && chain.includes(target.path)
  const tooDeep = chain.length > MAX_EMBED_DEPTH
  const content = useEmbedSource(circular || tooDeep ? undefined : target)

  if (isBase) return <BaseEmbed title={title} hostPath={chain[chain.length - 1] ?? ''} />
  if (!target) return <Placeholder>{`Note "${title}" not found`}</Placeholder>
  if (circular) return <Placeholder>{`Circular embed: "${title}"`}</Placeholder>
  if (tooDeep) return <Placeholder>Embed nested too deeply</Placeholder>

  const body = content === null ? '' : embedBody(content, heading)
  if (body === null) return <Placeholder>{`Heading "${heading}" not found in "${title}"`}</Placeholder>

  function openSource() {
    if (!target) return
    openTab(target.path)
    if (heading) {
      setPendingHighlight(target.path, heading, true)
      window.dispatchEvent(new Event('search:jump'))
    }
  }

  return (
    <NodeViewWrapper className="note-embed" spellCheck={false}>
      <button type="button" className="note-embed-header" contentEditable={false} onClick={openSource}>
        {wikiLinkText({ title, heading, label })}
      </button>
      <EmbedChainContext.Provider value={chain}>
        <EmbedBody key={body} markdown={body} path={target.path} />
      </EmbedChainContext.Provider>
    </NodeViewWrapper>
  )
}
