import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Editor, Range } from '@tiptap/core'
import { listen } from '@tauri-apps/api/event'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { Titlebar } from './Titlebar'
import { TooltipProvider } from './ui/tooltip'
import { NoteEditor } from '../editor/NoteEditor'
import { RawEditor } from '../editor/RawEditor'
import { SearchModal } from './SearchModal'
import { QuickSwitcher } from './QuickSwitcher'
import { BacklinksPanel } from './BacklinksPanel'
import { NoteHistoryPanel } from './NoteHistoryPanel'
import { OutlinePanel } from './OutlinePanel'
import { WorkspacePicker } from './WorkspacePicker'
import { LoadingStatus } from './LoadingStatus'
import { SettingsPanel } from './SettingsPanel'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { PromptDialog } from './PromptDialog'
import { TemplateDialog } from './TemplateDialog'
import { GraphView } from './GraphView'
import { TaskView } from './TaskView'
import { DeckView } from './DeckView'
import { ReviewSession } from './ReviewSession'
import { HomeView } from './HomeView'
import { FormulaSheetPrompt } from './FormulaSheetPrompt'
import { ExportPdfDialog } from './ExportPdfDialog'
import { PrintDialog } from './PrintDialog'
import { FlashcardTypeDialog } from './FlashcardTypeDialog'
import { TerminalPane } from './TerminalPane'
import { ToastStack } from './ToastStack'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useSettingsStore } from '../store/settings'
import { useNote } from '../hooks/useNote'
import { useWorkspace, refreshTags, refreshRecents } from '../hooks/useWorkspace'
import { useExternalChanges } from '../hooks/useExternalChanges'
import { useCreateNote } from '../hooks/useCreateNote'
import { useCreateFolder } from '../hooks/useCreateFolder'
import { useCreateCanvasNote } from '../hooks/useCreateCanvasNote'
import { useScrollRestoration } from '../hooks/useScrollRestoration'
import { useWindowTitle } from '../hooks/useWindowTitle'
import { useOverlayManager } from '../hooks/useOverlayManager'
import { ConflictBar } from './ConflictBar'
import { GitAutoCommitPrompt } from './GitAutoCommitPrompt'
import { GitDivergedBar } from './GitDivergedBar'
import { useGitConfig } from '../hooks/useGitConfig'
import { useGitAutoCommit } from '../hooks/useGitAutoCommit'
import { promptText } from '../store/promptDialog'
import { api } from '../lib/tauri'
import { goBack, goForward } from '../lib/navigationHistory'
import { useFocusModeStore } from '../store/focusMode'

type ViewMode = 'wysiwyg' | 'raw'

export function Layout() {
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const openTabs = useWorkspaceStore((s) => s.openTabs)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const reopenClosedTab = useWorkspaceStore((s) => s.reopenClosedTab)
  const focusMode = useFocusModeStore((s) => s.enabled)
  const toggleFocusMode = useFocusModeStore((s) => s.toggle)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const recentWorkspaces = useWorkspaceStore((s) => s.recentWorkspaces)
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
  const windowTitle = useWindowTitle(workspacePath, activeTab)
  const { saveSession, openWorkspace, openWorkspaceAt, closeWorkspace } = useWorkspace()
  const { updateGit } = useGitConfig()
  const { flushGitCommit } = useGitAutoCommit()
  const repoMode = useWorkspaceStore((s) => s.repoMode)
  const gitPrompted = useWorkspaceStore((s) => s.git.prompted)
  const gitCommitStatus = useWorkspaceStore((s) => s.gitCommitStatus)
  const gitCommitDetail = useWorkspaceStore((s) => s.gitCommitDetail)
  const gitDiverged = useWorkspaceStore((s) => s.gitDiverged)
  useExternalChanges()
  const createNote = useCreateNote()
  const createFolder = useCreateFolder()
  const createCanvasNote = useCreateCanvasNote()
  const [viewMode, setViewMode] = useState<ViewMode>('wysiwyg')
  const { activeOverlay, openOverlay, closeOverlay } = useOverlayManager()
  const [outlineOpen, setOutlineOpen] = useState(true)
  const editorPaneRef = useRef<HTMLDivElement>(null)
  const [terminalMounted, setTerminalMounted] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [pendingFlashcardInsert, setPendingFlashcardInsert] = useState<
    { editor: Editor; range: Range } | null
  >(null)
  const [pendingCramStreak, setPendingCramStreak] = useState<number | null>(null)
  const settings = useSettingsStore((s) => s.settings)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const scrollRef = useScrollRestoration(activeTab, isLoading, viewMode)

  // The backend vetoes the close and hands control here so a pending edit
  // reaches disk first; the window only dies once confirmClose is called.
  useEffect(() => {
    const unlisten = listen('close-requested', async () => {
      try {
        await flush()
        await saveSession()
        await flushGitCommit()
      } finally {
        await api.terminal.close()
        await api.window.confirmClose()
      }
    })
    return () => void unlisten.then((off) => off())
  }, [flush, saveSession, flushGitCommit])

  // The native menu is the only place these commands are defined, but on
  // Windows its accelerator table doesn't reliably fire `on_menu_event` from
  // the keyboard (WebView2 either claims the combo for its own browser-chrome
  // shortcut — Ctrl+P prints, Ctrl+Shift+R hard-reloads, Ctrl+Shift+I opens
  // DevTools — or the keystroke is just swallowed with no menu event at all;
  // both are upstream Tauri/wry issues, not something in our control). The
  // keydown listener further down is what actually makes every accelerator
  // shown on a menu item work — the menu's own dispatch only reliably fires
  // from a mouse click.
  const runCommand = useCallback(
    async (id: string) => {
      if (id.startsWith('open-recent:')) {
        await openWorkspaceAt(id.slice('open-recent:'.length))
        return
      }
      switch (id) {
        case 'new-note': {
          const title = await promptText('Note title:')
          if (title) await createNote(title)
          break
        }
        case 'new-folder': {
          const name = await promptText('Folder name:')
          if (name) await createFolder(name)
          break
        }
        case 'new-canvas': {
          const title = await promptText('Canvas note title:')
          if (title) await createCanvasNote(title)
          break
        }
        case 'new-from-template':
          if (workspacePath) openOverlay('template')
          break
        case 'open-workspace':
          await openWorkspace()
          break
        case 'close-workspace':
          if (workspacePath) await closeWorkspace()
          break
        case 'settings':
          openOverlay('settings')
          break
        case 'search':
          openOverlay('search')
          break
        case 'quick-switch':
          openOverlay('switcher')
          break
        case 'home':
          if (workspacePath) setActiveTab(null)
          break
        case 'toggle-view':
          if (activeTab) setViewMode((m) => (m === 'wysiwyg' ? 'raw' : 'wysiwyg'))
          break
        case 'insert-ink':
          window.dispatchEvent(new Event('command:insert-ink'))
          break
        case 'split-tasks':
          // Same shape as insert-ink: the editor instance stays in NoteEditor
          // rather than being lifted here just so a menu item can reach it.
          window.dispatchEvent(new Event('command:split-tasks'))
          break
        case 'export-pdf':
          if (!activeTab) break
          // The print stylesheet only styles the rendered view — switch
          // before the dialog opens so it's already correct by the time
          // the user clicks Export.
          setViewMode('wysiwyg')
          openOverlay('exportPdf')
          break
        case 'print':
          if (!activeTab) break
          setViewMode('wysiwyg')
          openOverlay('print')
          break
        case 'shortcuts-help':
          openOverlay('shortcuts')
          break
        case 'graph-view':
          if (workspacePath) openOverlay('graph')
          break
        case 'task-view':
          if (workspacePath) openOverlay('task')
          break
        case 'review':
          if (workspacePath) {
            setPendingCramStreak(null)
            openOverlay('review')
          }
          break
        case 'deck-view':
          if (workspacePath) openOverlay('deck')
          break
        case 'generate-formula-sheet':
          if (workspacePath) openOverlay('formulaSheet')
          break
        case 'toggle-terminal':
          if (!workspacePath) break
          setTerminalMounted(true)
          setTerminalOpen((o) => !o)
          break
        case 'toggle-outline':
          if (activeTab) setOutlineOpen((o) => !o)
          break
        case 'close-tab':
          if (activeTab) closeTab(activeTab)
          break
        case 'reopen-closed-tab':
          reopenClosedTab()
          break
        case 'toggle-focus-mode':
          toggleFocusMode()
          break
        case 'next-tab':
        case 'prev-tab': {
          if (openTabs.length < 2 || !activeTab) break
          const i = openTabs.indexOf(activeTab)
          const step = id === 'next-tab' ? 1 : -1
          setActiveTab(openTabs[(i + step + openTabs.length) % openTabs.length] ?? null)
          break
        }
      }
    },
    [
      activeTab,
      viewMode,
      workspacePath,
      openTabs,
      setActiveTab,
      closeTab,
      reopenClosedTab,
      toggleFocusMode,
      createNote,
      createFolder,
      createCanvasNote,
      openWorkspace,
      openWorkspaceAt,
      closeWorkspace,
      openOverlay,
    ],
  )

  const handleFlashcardCommand = useCallback(
    (editor: Editor, range: Range) => {
      setPendingFlashcardInsert({ editor, range })
      openOverlay('flashcard')
    },
    [openOverlay],
  )

  useEffect(() => {
    const unlisten = listen<string>('menu-action', (event) => void runCommand(event.payload))
    return () => void unlisten.then((off) => off())
  }, [runCommand])

  // WebDriver automates the WebView, not the native menu bar, so a
  // menu-only action (this one, graph-view, toggle-terminal, …) has no path
  // e2e can reach — which is exactly how the outline panel's freeze (P6-6
  // postmortem, docs/ROADMAP.md) shipped with zero coverage. This is the
  // same dispatcher a real menu click uses, just reachable from a test.
  useEffect(() => {
    ;(window as unknown as { __e2eRunCommand?: (id: string) => void }).__e2eRunCommand = runCommand
  }, [runCommand])

  // `?` has no natural menu-accelerator form and is safe to double-fire
  // (opening an already-open overlay is a no-op), so it stays a plain
  // DOM listener rather than a menu item. Must skip editable targets: typing
  // a literal `?` into a note or any text field is otherwise indistinguishable
  // from asking for this overlay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '?' || e.ctrlKey || e.metaKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      openOverlay('shortcuts')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openOverlay])

  // Alt+Left/Right for link-driven navigation history (wiki-links,
  // cross-references — see lib/navigationHistory.ts). No native editing
  // meaning to collide with, so no editable-target guard is needed, unlike
  // the `?` listener above. The main Ctrl/Meta shortcut map above explicitly
  // excludes Alt combos, so this can't collide with it either.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goBack()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goForward()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Every CmdOrCtrl accelerator shown in `build_menu` (src-tauri/src/lib.rs)
  // needs this to actually fire on Windows — see the comment on `runCommand`.
  // None of these combinations are ever legitimate to type into a note (they
  // all require Ctrl), so unlike the `?` listener above there's no editable
  // target to guard against.
  useEffect(() => {
    const KEY_COMMANDS: Record<string, string> = {
      n: 'new-note',
      'shift+n': 'new-folder',
      'shift+t': 'new-from-template',
      o: 'open-workspace',
      k: 'search',
      p: 'quick-switch',
      e: 'toggle-view',
      'shift+i': 'insert-ink',
      g: 'graph-view',
      '`': 'toggle-terminal',
      'shift+o': 'toggle-outline',
      'shift+k': 'task-view',
      'shift+r': 'review',
      'shift+d': 'deck-view',
      ',': 'settings',
      h: 'home',
      w: 'close-tab',
      'shift+w': 'reopen-closed-tab',
      'shift+f': 'toggle-focus-mode',
      Tab: 'next-tab',
      'shift+Tab': 'prev-tab',
    }
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const commandId = KEY_COMMANDS[e.shiftKey ? `shift+${key}` : key]
      if (!commandId) return
      e.preventDefault()
      void runCommand(commandId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runCommand])

  useEffect(() => {
    void api.workspace.initialWorkspace().then((path) => {
      if (path) void openWorkspaceAt(path, { remember: false })
    })
    void refreshRecents()
    void api.settings.load().then(setSettings)
  }, [setSettings, openWorkspaceAt])

  useEffect(() => {
    setViewMode('wysiwyg')
  }, [activeTab])

  useEffect(() => {
    void refreshTags()
  }, [activeTab])

  return (
    <TooltipProvider>
    <div className="app-shell">
    <Titlebar title={windowTitle} onCommand={runCommand} recentWorkspaces={recentWorkspaces} />
    <div className="layout">
      {activeOverlay === 'search' && <SearchModal onClose={closeOverlay} />}
      {activeOverlay === 'switcher' && <QuickSwitcher onClose={closeOverlay} />}
      {activeOverlay === 'settings' && <SettingsPanel onClose={closeOverlay} />}
      {activeOverlay === 'shortcuts' && <ShortcutsOverlay onClose={closeOverlay} />}
      <PromptDialog />
      <ToastStack />
      {activeOverlay === 'template' && <TemplateDialog onClose={closeOverlay} />}
      {activeOverlay === 'graph' && <GraphView onClose={closeOverlay} />}
      {activeOverlay === 'task' && <TaskView onClose={closeOverlay} />}
      {activeOverlay === 'review' && (
        <ReviewSession
          mode={pendingCramStreak !== null ? { kind: 'cram', streak: pendingCramStreak } : { kind: 'due' }}
          onClose={() => {
            setPendingCramStreak(null)
            closeOverlay()
          }}
          onSwitchCategory={(streak) => setPendingCramStreak(streak)}
        />
      )}
      {activeOverlay === 'deck' && (
        <DeckView
          onClose={closeOverlay}
          onOpenCram={(streak) => {
            setPendingCramStreak(streak)
            openOverlay('review')
          }}
        />
      )}
      {activeOverlay === 'formulaSheet' && <FormulaSheetPrompt onClose={closeOverlay} />}
      {activeOverlay === 'exportPdf' && currentNote && (
        <ExportPdfDialog noteTitle={currentNote.title} contentRef={editorPaneRef} onClose={closeOverlay} />
      )}
      {activeOverlay === 'print' && currentNote && (
        <PrintDialog noteTitle={currentNote.title} contentRef={editorPaneRef} onClose={closeOverlay} />
      )}
      {activeOverlay === 'flashcard' && pendingFlashcardInsert && (
        <FlashcardTypeDialog
          onPick={(stub) => {
            const { editor, range } = pendingFlashcardInsert
            editor.chain().focus().deleteRange(range).insertContent(stub).run()
            setPendingFlashcardInsert(null)
            closeOverlay()
          }}
          onClose={() => {
            setPendingFlashcardInsert(null)
            closeOverlay()
          }}
        />
      )}
      {!focusMode && (
        <Sidebar
          onSearchOpen={() => openOverlay('search')}
          onSettingsOpen={() => openOverlay('settings')}
          onTemplateOpen={() => openOverlay('template')}
          onGraphOpen={() => openOverlay('graph')}
          onTaskOpen={() => openOverlay('task')}
          onReviewOpen={() => {
            setPendingCramStreak(null)
            openOverlay('review')
          }}
          onFormulaSheetOpen={() => openOverlay('formulaSheet')}
          onTerminalToggle={() => {
            setTerminalMounted(true)
            setTerminalOpen((o) => !o)
          }}
        />
      )}
      <div className="main">
        <TabBar
          viewMode={viewMode}
          onToggleView={() => setViewMode((m) => (m === 'wysiwyg' ? 'raw' : 'wysiwyg'))}
          saveState={saveState}
          saveError={saveError}
          onRetrySave={() => void retrySave()}
          onDismissSaveError={dismissError}
          gitCommitStatus={gitCommitStatus}
          gitCommitDetail={gitCommitDetail}
        />
        {conflict && <ConflictBar onKeepMine={keepMine} onReloadTheirs={reloadTheirs} />}
        {gitDiverged && (
          <GitDivergedBar
            ahead={gitDiverged.ahead}
            behind={gitDiverged.behind}
            onDismiss={() => useWorkspaceStore.getState().setGitDiverged(null)}
          />
        )}
        {repoMode && !gitPrompted && (
          <GitAutoCommitPrompt
            mode={repoMode}
            onEnable={() => void updateGit({ prompted: true, autoCommit: true })}
            onDecline={() => void updateGit({ prompted: true })}
          />
        )}
        <div className="editor-body">
          <div className="editor-scroll" ref={scrollRef}>
            <div
              ref={editorPaneRef}
              className={`editor-pane${!activeTab && !workspacePath ? ' editor-pane--center' : ''}`}
              style={{ '--editor-max-width': `${settings.editorMaxWidthPx}px` } as CSSProperties}
            >
              {isLoading && <LoadingStatus />}
              {!isLoading && activeTab && viewMode === 'wysiwyg' && (
                <NoteEditor
                  content={content}
                  notePath={activeTab}
                  spellcheck={settings.spellcheck}
                  spellcheckLanguage={settings.spellcheckLanguage}
                  onChange={(md) => void save(md)}
                  onFlashcardCommand={handleFlashcardCommand}
                />
              )}
              {!isLoading && activeTab && viewMode === 'raw' && (
                <RawEditor
                  content={content}
                  notePath={activeTab}
                  spellcheck={settings.spellcheck}
                  spellcheckLanguage={settings.spellcheckLanguage}
                  onChange={(md) => void save(md)}
                />
              )}
              {!activeTab && !workspacePath && <WorkspacePicker />}
              {!activeTab && workspacePath && notes.length === 0 && (
                <p className="empty-state">
                  Press Ctrl N to create your first note, or press ? for shortcuts
                </p>
              )}
              {!activeTab && workspacePath && notes.length > 0 && (
                <HomeView
                  onOpenTaskView={() => openOverlay('task')}
                  onOpenReview={() => {
                    setPendingCramStreak(null)
                    openOverlay('review')
                  }}
                  onOpenDeckView={() => openOverlay('deck')}
                  onOpenSettings={() => openOverlay('settings')}
                  overlayOpen={activeOverlay !== null}
                />
              )}
              {!isLoading && activeTab && currentNote && (
                <BacklinksPanel notePath={activeTab} noteTitle={currentNote.title} />
              )}
              {!isLoading && activeTab && repoMode && (
                <NoteHistoryPanel
                  notePath={activeTab}
                  saveState={saveState}
                  onRestore={(content) => void save(content)}
                />
              )}
            </div>
          </div>
          {!isLoading && activeTab && viewMode === 'wysiwyg' && outlineOpen && (
            <OutlinePanel content={content} containerRef={editorPaneRef} />
          )}
        </div>
        {terminalMounted && workspacePath && (
          <TerminalPane
            workspace={workspacePath}
            notePath={activeTab}
            hidden={!terminalOpen}
            onClose={() => setTerminalOpen(false)}
          />
        )}
      </div>
    </div>
    </div>
    </TooltipProvider>
  )
}
