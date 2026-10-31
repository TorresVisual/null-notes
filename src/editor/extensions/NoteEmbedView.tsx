import { useContext } from 'react'
import type { ReactNode } from 'react'
import { useEditor, EditorContent, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useNotesStore } from '../../store/notes'
import { useWorkspaceStore } from '../../store/workspace'
import { useEmbedSource } from '../../hooks/useEmbedSource'
import { embedBody } from '../../lib/embedSyntax'
import { setPendingHighlight } from '../../lib/pendingHighlight'
import { wikiLinkText } from '../../lib/wikiLinkSyntax'
import { extensionsFor } from './index'
import { EmbedChainContext, MAX_EMBED_DEPTH } from './EmbedChainContext'

interface EmbedAttrs {
  title: string
  heading: string
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <NodeViewWrapper className="note-embed note-embed-missing" spellCheck={false}>
      {children}
    </NodeViewWrapper>
  )
}

function EmbedBody({ markdown, path }: { markdown: string; path: string }) {
  const editor = useEditor({ extensions: extensionsFor(path), content: markdown, editable: false })
  return <EditorContent className="note-embed-body" editor={editor} />
}

export function NoteEmbedView({ node, editor }: ReactNodeViewProps) {
  const { title, heading } = node.attrs as unknown as EmbedAttrs
  const notes = useNotesStore((s) => s.notes)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const chain = [...useContext(EmbedChainContext), editor.storage.noteContext.notePath]

  const target = notes.find((n) => n.title.toLowerCase() === title.toLowerCase())
  const circular = target !== undefined && chain.includes(target.path)
  const tooDeep = chain.length > MAX_EMBED_DEPTH
  const content = useEmbedSource(circular || tooDeep ? undefined : target)

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
        {wikiLinkText({ title, heading, label: '' })}
      </button>
      <EmbedChainContext.Provider value={chain}>
        <EmbedBody key={body} markdown={body} path={target.path} />
      </EmbedChainContext.Provider>
    </NodeViewWrapper>
  )
}
