import { useOutgoingLinks } from '../hooks/useOutgoingLinks'
import { useCreateNote } from '../hooks/useCreateNote'
import { useWorkspaceStore } from '../store/workspace'
import { LINK_MENTION_EVENT } from '../editor/linkMention'
import type { NoteMetadata } from '../types'

interface OutgoingLinksPanelProps {
  content: string
  notePath: string
}

function folderLabel(note: NoteMetadata): string {
  const relative = note.path.slice(note.workspace.length).replace(/\\/g, '/')
  return relative.replace(/^\/+/, '').replace(/\/?[^/]*$/, '') || '/'
}

function Count({ n }: { n: number }) {
  return n > 1 ? <span className="outgoing-count">×{n}</span> : null
}

export function OutgoingLinksPanel({ content, notePath }: OutgoingLinksPanelProps) {
  const { links, unresolved, possible } = useOutgoingLinks(content, notePath)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const createNote = useCreateNote()

  return (
    <aside className="outgoing-panel" aria-label="Outgoing links">
      <h3 className="outline-panel-title">Links ({links.length})</h3>
      {links.length === 0 ? (
        <p className="backlinks-empty">This note links to no other notes.</p>
      ) : (
        <ul className="backlinks-list">
          {links.map(({ key, candidates, count }) => (
            <li key={key}>
              {candidates.map((note) => (
                <button key={note.path} className="backlink-item" onClick={() => openTab(note.path)}>
                  <span className="backlink-title">
                    {note.title}
                    <Count n={count} />
                  </span>
                  {candidates.length > 1 && <span className="outgoing-folder">{folderLabel(note)}</span>}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}

      <h3 className="outline-panel-title">Unresolved ({unresolved.length})</h3>
      {unresolved.length === 0 ? (
        <p className="backlinks-empty">Every link points at a note.</p>
      ) : (
        <ul className="backlinks-list">
          {unresolved.map(({ key, label, title, folder, blocked, count }) => (
            <li key={key}>
              <button
                className="backlink-item"
                disabled={blocked}
                title={blocked ? 'Points outside this note’s folder' : `Create note "${title}"`}
                onClick={() => void createNote(title, undefined, folder)}
              >
                <span className="backlink-title wiki-link-missing">
                  {label}
                  <Count n={count} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="outline-panel-title">Possible links ({possible.length})</h3>
      {possible.length === 0 ? (
        <p className="backlinks-empty">No unlinked mentions of other notes.</p>
      ) : (
        <ul className="backlinks-list">
          {possible.map(({ title, candidates, count }) => (
            <li key={title}>
              <button
                className="backlink-item"
                title={`Link "${title}"`}
                onClick={() =>
                  window.dispatchEvent(new CustomEvent(LINK_MENTION_EVENT, { detail: { notePath, title } }))
                }
              >
                <span className="backlink-title">
                  {title}
                  <Count n={count} />
                </span>
                {candidates.length > 1 && (
                  <span className="outgoing-folder">
                    {candidates.length} notes share this title: {candidates.map(folderLabel).join(', ')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
