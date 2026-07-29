import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { NoteEditor } from '../editor/NoteEditor'
import { RawEditor } from '../editor/RawEditor'
import { SearchModal } from './SearchModal'
import { QuickSwitcher } from './QuickSwitcher'
import { BacklinksPanel } from './BacklinksPanel'
import { WorkspacePicker } from './WorkspacePicker'
import { SettingsPanel } from './SettingsPanel'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useSettingsStore } from '../store/settings'
import { useNote } from '../hooks/useNote'
import { useWorkspace, refreshTags, refreshRecents } from '../hooks/useWorkspace'
import { useExternalChanges } from '../hooks/useExternalChanges'
import { useCreateNote } from '../hooks/useCreateNote'
import { useCreateFolder } from '../hooks/useCreateFolder'
import { useCreateCanvasNote } from '../hooks/useCreateCanvasNote'
import { ConflictBar } from './ConflictBar'
import { api } from '../lib/tauri'

type ViewMode = 'wysiwyg' | 'raw'

export function Layout() {
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const workspacePath = useWorkspaceStore((s) => s.path)
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
  const { saveSession, openWorkspace } = useWorkspace()
  useExternalChanges()
  const createNote = useCreateNote()
  const createFolder = useCreateFolder()
  const createCanvasNote = useCreateCanvasNote()
  const [viewMode, setViewMode] = useState<ViewMode>('wysiwyg')
  const [searchOpen, setSearchOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const settings = useSettingsStore((s) => s.settings)
  const setSettings = useSettingsStore((s) => s.setSettings)

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

  // The native File/Edit/View menu is the single source of truth for every
  // modifier-key shortcut (accelerators shown on the menu items themselves) —
  // this dispatcher is the only place any of these actions actually runs, so
  // there is no risk of a menu accelerator and a DOM keydown handler both
  // firing the same action from one keystroke.
  const runCommand = useCallback(
    async (id: string) => {
      switch (id) {
        case 'new-note': {
          const title = prompt('Note title:')
          if (title) await createNote(title)
          break
        }
        case 'new-folder': {
          const name = prompt('Folder name:')
          if (name) await createFolder(name)
          break
        }
        case 'new-canvas': {
          const title = prompt('Canvas note title:')
          if (title) await createCanvasNote(title)
          break
        }
        case 'open-workspace':
          await openWorkspace()
          break
        case 'settings':
          setSettingsOpen(true)
          break
        case 'search':
          setSearchOpen(true)
          break
        case 'quick-switch':
          setSwitcherOpen(true)
          break
        case 'toggle-view':
          if (activeTab) setViewMode((m) => (m === 'wysiwyg' ? 'raw' : 'wysiwyg'))
          break
        case 'insert-ink':
          window.dispatchEvent(new Event('command:insert-ink'))
          break
        case 'export-pdf':
          if (!activeTab) break
          // The print stylesheet only styles the rendered view; printing raw
          // markdown text wouldn't match the editor, so switch first and let
          // that render before the OS print dialog captures the page.
          if (viewMode === 'raw') {
            setViewMode('wysiwyg')
            requestAnimationFrame(() => window.print())
          } else {
            window.print()
          }
          break
        case 'shortcuts-help':
          setShortcutsOpen(true)
          break
      }
    },
    [activeTab, viewMode, createNote, createFolder, createCanvasNote, openWorkspace],
  )

  useEffect(() => {
    const unlisten = listen<string>('menu-action', (event) => void runCommand(event.payload))
    return () => void unlisten.then((off) => off())
  }, [runCommand])

  // `?` has no natural menu-accelerator form and is safe to double-fire
  // (opening an already-open overlay is a no-op), so it stays a plain
  // DOM listener rather than a menu item.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    void refreshRecents()
    void api.settings.load().then(setSettings)
  }, [setSettings])

  useEffect(() => {
    setViewMode('wysiwyg')
  }, [activeTab])

  useEffect(() => {
    void refreshTags()
  }, [activeTab])

  return (
    <div className="layout">
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      {switcherOpen && <QuickSwitcher onClose={() => setSwitcherOpen(false)} />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
      <Sidebar onSearchOpen={() => setSearchOpen(true)} onSettingsOpen={() => setSettingsOpen(true)} />
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
          <div
            className="editor-pane"
            style={{ '--editor-max-width': `${settings.editorMaxWidthPx}px` } as CSSProperties}
          >
            {isLoading && <p className="status">Loading…</p>}
            {!isLoading && activeTab && viewMode === 'wysiwyg' && (
              <NoteEditor content={content} notePath={activeTab} onChange={(md) => void save(md)} />
            )}
            {!isLoading && activeTab && viewMode === 'raw' && (
              <RawEditor content={content} onChange={(md) => void save(md)} />
            )}
            {!activeTab && !workspacePath && <WorkspacePicker />}
            {!activeTab && workspacePath && notes.length === 0 && (
              <p className="empty-state">
                Press Ctrl N to create your first note, or press ? for shortcuts
              </p>
            )}
            {!activeTab && workspacePath && notes.length > 0 && (
              <p className="empty-state">
                Select a note, press Ctrl P to jump to one, or press ? for shortcuts
              </p>
            )}
            {!isLoading && activeTab && currentNote && (
              <BacklinksPanel notePath={activeTab} noteTitle={currentNote.title} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
