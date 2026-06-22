import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { NoteEditor } from '../editor/NoteEditor'
import { useWorkspaceStore } from '../store/workspace'
import { useNote } from '../hooks/useNote'
import { useWorkspace } from '../hooks/useWorkspace'

export function Layout() {
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const { content, save, isLoading } = useNote(activeTab)
  const { saveSession } = useWorkspace()

  useEffect(() => {
    const handler = () => { void saveSession() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [saveSession])

  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        <TabBar />
        <div className="editor-pane">
          {isLoading && <p className="status">Loading…</p>}
          {!isLoading && activeTab && (
            <NoteEditor content={content} onChange={(md) => void save(md)} />
          )}
          {!activeTab && (
            <p className="empty-state">Open a workspace and select a note</p>
          )}
        </div>
      </div>
    </div>
  )
}
