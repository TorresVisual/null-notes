import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { NoteEditor } from '../editor/NoteEditor'
import { RawEditor } from '../editor/RawEditor'
import { SearchModal } from './SearchModal'
import { BacklinksPanel } from './BacklinksPanel'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useNote } from '../hooks/useNote'
import { useWorkspace, refreshTags } from '../hooks/useWorkspace'
import { useExternalChanges } from '../hooks/useExternalChanges'
import { ConflictBar } from './ConflictBar'
import { InkPage } from '../ink/InkPage'
import { canvasSrcFrom } from '../lib/canvasNote'
import { api } from '../lib/tauri'

type ViewMode = 'wysiwyg' | 'raw'

export function Layout() {
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const notes = useNotesStore((s) => s.notes)
  const currentNote = notes.find((n) => n.path === activeTab)
  const {
    content,
    save,
    isLoading,
    saveState,
    saveError,
    flush,
    retrySave,
    dismissError,
    conflict,
    keepMine,
    reloadTheirs,
  } = useNote(activeTab)
  const { saveSession } = useWorkspace()
  useExternalChanges()
  // A canvas note keeps its strokes in an SVG sidecar, so the .md itself never
  // changes while you write — only the Source view ever needs the text.
  const canvasSrc = canvasSrcFrom(content)
  const [viewMode, setViewMode] = useState<ViewMode>('wysiwyg')
  const [searchOpen, setSearchOpen] = useState(false)

  // The backend vetoes the close and hands control here so a pending edit
  // reaches disk first; the window only dies once confirmClose is called.
  useEffect(() => {
    const unlisten = listen('close-requested', async () => {
      try {
        await flush()
        await saveSession()
      } finally {
        await api.window.confirmClose()
      }
    })
    return () => void unlisten.then((off) => off())
  }, [flush, saveSession])

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

  useEffect(() => {
    void refreshTags()
  }, [activeTab])

  return (
    <div className="layout">
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      <Sidebar onSearchOpen={() => setSearchOpen(true)} />
      <div className="main">
        <TabBar
          viewMode={viewMode}
          onToggleView={() => setViewMode((m) => (m === 'wysiwyg' ? 'raw' : 'wysiwyg'))}
          saveState={saveState}
          saveError={saveError}
          onRetrySave={() => void retrySave()}
          onDismissSaveError={dismissError}
        />
        {conflict && <ConflictBar onKeepMine={keepMine} onReloadTheirs={reloadTheirs} />}
        <div className="editor-scroll">
          {canvasSrc && !isLoading && activeTab && viewMode === 'wysiwyg' ? (
            <InkPage svgPath={canvasSrc} />
          ) : (
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
            {!isLoading && activeTab && currentNote && (
              <BacklinksPanel notePath={activeTab} noteTitle={currentNote.title} />
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
