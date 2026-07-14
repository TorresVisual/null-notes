import { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { NoteEditor } from '../editor/NoteEditor'
import { RawEditor } from '../editor/RawEditor'
import { SearchModal } from './SearchModal'
import { useWorkspaceStore } from '../store/workspace'
import { useNote } from '../hooks/useNote'
import { useWorkspace } from '../hooks/useWorkspace'

type ViewMode = 'wysiwyg' | 'raw'

export function Layout() {
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const { content, save, isLoading } = useNote(activeTab)
  const { saveSession } = useWorkspace()
  const [viewMode, setViewMode] = useState<ViewMode>('wysiwyg')
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const handler = () => { void saveSession() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [saveSession])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    setViewMode('wysiwyg')
  }, [activeTab])

  return (
    <div className="layout">
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      <Sidebar onSearchOpen={() => setSearchOpen(true)} />
      <div className="main">
        <TabBar
          viewMode={viewMode}
          onToggleView={() => setViewMode((m) => (m === 'wysiwyg' ? 'raw' : 'wysiwyg'))}
        />
        <div className="editor-scroll">
          <div className="editor-pane">
            {isLoading && <p className="status">Loading…</p>}
            {!isLoading && activeTab && viewMode === 'wysiwyg' && (
              <NoteEditor content={content} notePath={activeTab} onChange={(md) => void save(md)} />
            )}
            {!isLoading && activeTab && viewMode === 'raw' && (
              <RawEditor content={content} onChange={(md) => void save(md)} />
            )}
            {!activeTab && (
              <p className="empty-state">Open a workspace and select a note</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
