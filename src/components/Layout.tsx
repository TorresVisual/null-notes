import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { Editor, Range } from '@tiptap/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { Titlebar } from './Titlebar'
import { TooltipProvider } from './ui/tooltip'
import { EditorPane } from './EditorPane'
import { ErrorBoundary } from './ErrorBoundary'
import { SearchModal } from './SearchModal'
import { QuickSwitcher } from './QuickSwitcher'
import { CommandPalette } from './CommandPalette'
import { OutlinePanel } from './OutlinePanel'
import { OutgoingLinksPanel } from './OutgoingLinksPanel'
import { SettingsPanel } from './SettingsPanel'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { PromptDialog } from './PromptDialog'
import { TemplateDialog } from './TemplateDialog'
import { GraphView } from './GraphView'
import { TaskView } from './TaskView'
import { DeckView } from './DeckView'
import { ReviewSession, type ReviewMode } from './ReviewSession'
import { HomeView } from './HomeView'
import { MobileShell } from './MobileShell'
import { SaveStatus } from './SaveStatus'
import { FormulaSheetPrompt } from './FormulaSheetPrompt'
import { FlashcardTypeDialog } from './FlashcardTypeDialog'
import { DiagramPickerDialog } from './DiagramPickerDialog'
import { ToastStack } from './ToastStack'
import { UpdateDialog } from './UpdateDialog'
import { TrashDialog } from './TrashDialog'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useSettingsStore } from '../store/settings'
import { clampZoom } from '../lib/zoom'
import { useNote } from '../hooks/useNote'
import { flushAllNotes } from '../store/noteBuffers'
import { useResetPageScroll } from '../hooks/useResetPageScroll'
import { useCreateCanvas } from '../hooks/useCreateCanvas'
import { isBasePath, isCanvasPath } from '../lib/canvasPath'
import { flushAllCanvases } from '../lib/canvasFlush'
import { useWorkspace, refreshTags, refreshRecents } from '../hooks/useWorkspace'
import { useExternalChanges } from '../hooks/useExternalChanges'
import { useBookmarksStore } from '../store/bookmarks'
import { useCreateNote } from '../hooks/useCreateNote'
import { useCreateFolder } from '../hooks/useCreateFolder'
import { useCreateCanvasNote } from '../hooks/useCreateCanvasNote'
import { useScrollRestoration } from '../hooks/useScrollRestoration'
import { useWindowTitle } from '../hooks/useWindowTitle'
import { useOverlayManager } from '../hooks/useOverlayManager'
import { GitAutoCommitPrompt } from './GitAutoCommitPrompt'
import { GitDivergedBar } from './GitDivergedBar'
import { GitPullBlockedBar } from './GitPullBlockedBar'
import { GitAheadBar } from './GitAheadBar'
import { useGitConfig } from '../hooks/useGitConfig'
import { useGitAutoCommit } from '../hooks/useGitAutoCommit'
import { useReportDirtyPaths } from '../hooks/useReportDirtyPaths'
import { useGitAutoPull } from '../hooks/useGitAutoPull'
import { promptText } from '../store/promptDialog'
import {
  copyNotePath,
  deleteNote,
  duplicateNote,
  mergeNotes,
  moveNoteViaPicker,
  openNoteExternally,
  renameNote,
  revealNote,
} from '../lib/noteActions'
import { api } from '../lib/tauri'
import { diagramApi } from '../lib/diagram'
import { insertDiagram } from '../editor/toolbar/insertDiagram'
import { report } from '../editor/splitIntoTasks'
import type { DiagramMetadata } from '../types'
import { goBack, goForward } from '../lib/navigationHistory'
import { comboFromEvent, isGlobalCombo } from '../lib/keymap'
import { useKeymap } from '../hooks/useKeymap'
import { requestCloseTab } from '../lib/requestCloseTab'
import { useFocusModeStore } from '../store/focusMode'
import { canPushHere, pushIfAllowed, withGitLock } from '../lib/git'
import { isMobile, isWeb } from '../lib/platform'

// pagedjs (print preview) and xterm (terminal) are ~850 KB of source between
// them and only load when their overlay/pane is first opened.
const ExportPdfDialog = lazy(() => import('./ExportPdfDialog').then((m) => ({ default: m.ExportPdfDialog })))
const PrintDialog = lazy(() => import('./PrintDialog').then((m) => ({ default: m.PrintDialog })))
const BasePane = lazy(() => import('./BasePane').then((m) => ({ default: m.BasePane })))
const CanvasPane = lazy(() => import('./CanvasPane').then((m) => ({ default: m.CanvasPane })))
const TerminalPane = lazy(() => import('./TerminalPane').then((m) => ({ default: m.TerminalPane })))

type ViewMode = 'wysiwyg' | 'raw'

const GIT_FLUSH_ON_CLOSE_TIMEOUT_MS = 5000

export function Layout() {
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  // A canvas or a base: a file tab with its own pane instead of the note editor.
  const canvasTab = activeTab !== null && (isCanvasPath(activeTab) || isBasePath(activeTab))
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const openTabs = useWorkspaceStore((s) => s.openTabs)
  const togglePinTab = useWorkspaceStore((s) => s.togglePinTab)
  const activeTabPinned = useWorkspaceStore((s) => s.activeTab !== null && s.pinnedTabs.includes(s.activeTab))
  const reopenClosedTab = useWorkspaceStore((s) => s.reopenClosedTab)
  const focusMode = useFocusModeStore((s) => s.enabled)
  const toggleFocusMode = useFocusModeStore((s) => s.toggle)
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar)
  const mobile = isMobile()
  useResetPageScroll()
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
    retrySave,
    dismissError,
    conflict,
    keepMine,
    reloadTheirs,
  } = useNote(canvasTab ? null : activeTab)
  const windowTitle = useWindowTitle(workspacePath, activeTab)
  const { saveSession, openWorkspace, openWorkspaceAt, openSingleNote, closeWorkspace } = useWorkspace()
  const { updateGit } = useGitConfig()
  const { flushGitCommit } = useGitAutoCommit()
  useReportDirtyPaths()
  const { checkForUpdates } = useGitAutoPull()
  const repoMode = useWorkspaceStore((s) => s.repoMode)
  const singleNote = useWorkspaceStore((s) => s.singleNote)
  const gitPrompted = useWorkspaceStore((s) => s.git.prompted)
  const gitPriorAutomation = useWorkspaceStore((s) => s.gitPriorAutomation)
  const gitCommitStatus = useWorkspaceStore((s) => s.gitCommitStatus)
  const gitCommitDetail = useWorkspaceStore((s) => s.gitCommitDetail)
  const gitDiverged = useWorkspaceStore((s) => s.gitDiverged)
  const gitPullBlocked = useWorkspaceStore((s) => s.gitPullBlocked)
  const gitAhead = useWorkspaceStore((s) => s.gitAhead)
  useExternalChanges()
  const createNote = useCreateNote()
  const createFolder = useCreateFolder()
  const createCanvasNote = useCreateCanvasNote()
  const createAgentCanvas = useCreateCanvas()
  const [primaryViewMode, setPrimaryViewMode] = useState<ViewMode>('wysiwyg')
  const { activeOverlay, openOverlay, closeOverlay } = useOverlayManager()
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [outgoingLinksOpen, setOutgoingLinksOpen] = useState(false)
  const editorPaneRef = useRef<HTMLDivElement>(null)
  const [terminalMounted, setTerminalMounted] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [mergeSource, setMergeSource] = useState<string | null>(null)
  const [pendingFlashcardInsert, setPendingFlashcardInsert] = useState<
    { editor: Editor; range: Range } | null
  >(null)
  const [pendingDiagramInsert, setPendingDiagramInsert] = useState<
    { editor: Editor; range: Range | null; diagrams: DiagramMetadata[] } | null
  >(null)
  const [pendingCram, setPendingCram] = useState<Exclude<ReviewMode, { kind: 'due' }> | null>(null)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const uiZoomPct = useSettingsStore((s) => s.settings.uiZoomPct)
  useEffect(() => {
    document.documentElement.style.zoom = String(uiZoomPct / 100)
  }, [uiZoomPct])
  const scrollRef = useScrollRestoration(activeTab, isLoading, primaryViewMode)

  // The backend vetoes the close and hands control here so a pending edit
  // reaches disk first; the window only dies once confirmClose is called.
  useEffect(() => {
    const unlisten = listen('close-requested', async () => {
      try {
        await flushAllNotes()
        await flushAllCanvases()
        await saveSession()
        // A hung commit hook or push must not trap the window open; the
        // notes are already on disk and the batch is only a convenience.
        await Promise.race([
          flushGitCommit(),
          new Promise((resolve) => setTimeout(resolve, GIT_FLUSH_ON_CLOSE_TIMEOUT_MS)),
        ])
      } finally {
        try {
          await api.terminal.close()
        } finally {
          await api.window.confirmClose()
        }
      }
    })
    return () => void unlisten.then((off) => off())
  }, [saveSession, flushGitCommit])

  // #77: the open-time check in useWorkspace only ever fires once, so a
  // workspace left open never learns it fell behind a remote another
  // machine pushed to. Re-run it on an interval and on window focus.
  useEffect(() => {
    if (!repoMode || !workspacePath) return
    const check = () => void checkForUpdates(workspacePath)
    const interval = setInterval(check, 5 * 60_000)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', check)
    }
  }, [repoMode, workspacePath, checkForUpdates])

  // #85: manual fallback for the multi-machine workflow — commit, push, and
  // pull right now instead of waiting out the idle timer or the 5-minute
  // poll. Works even with autoCommit/autoPush off (flushGitCommit's `force`,
  // and canPushHere's mode-only gating instead of canAutoPush's toggle
  // check) — a disabled toggle is exactly when a manual trigger matters.
  const [syncingNow, setSyncingNow] = useState(false)
  const syncNow = useCallback(async () => {
    if (!workspacePath || !repoMode) return
    setSyncingNow(true)
    try {
      await flushGitCommit(true)
      const { git } = useWorkspaceStore.getState()
      // #86: flushGitCommit and checkForUpdates already lock their own
      // whole operation; this direct push needs the same guard so it can't
      // race one of those firing from another trigger (idle timer, interval,
      // focus) at the same moment.
      if (canPushHere(repoMode, git)) {
        await withGitLock(() => pushIfAllowed(workspacePath, repoMode, git))
      }
      await checkForUpdates(workspacePath)
    } finally {
      setSyncingNow(false)
    }
  }, [workspacePath, repoMode, flushGitCommit, checkForUpdates])

  // The native menu is the only place these commands are defined, but on
  // Windows its accelerator table doesn't reliably fire `on_menu_event` from
  // the keyboard (WebView2 either claims the combo for its own browser-chrome
  // shortcut — Ctrl+P prints, Ctrl+Shift+R hard-reloads, Ctrl+Shift+I opens
  // DevTools — or the keystroke is just swallowed with no menu event at all;
  // both are upstream Tauri/wry issues, not something in our control). The
  // keydown listener further down is what actually makes every accelerator
  // shown on a menu item work — the menu's own dispatch only reliably fires
  // from a mouse click.
  const requestMerge = useCallback(
    (path: string) => {
      setMergeSource(path)
      openOverlay('mergeTarget')
    },
    [openOverlay],
  )

  // A pending debounced save landing after the merge would write the
  // trashed source back to disk.
  const flushThenMerge = useCallback(
    async (source: string, dest: string) => {
      await flushAllNotes()
      await mergeNotes(source, dest)
    },
    [],
  )

  useEffect(() => {
    const handler = (e: Event) => requestMerge((e as CustomEvent<string>).detail)
    window.addEventListener('note:merge-request', handler)
    return () => window.removeEventListener('note:merge-request', handler)
  }, [requestMerge])

  const runCommand = useCallback(
    async (id: string) => {
      if (id.startsWith('open-recent:')) {
        await openWorkspaceAt(id.slice('open-recent:'.length))
        return
      }
      if (id.startsWith('goto-tab:')) {
        const n = Number(id.slice('goto-tab:'.length))
        const target = n === 9 ? openTabs[openTabs.length - 1] : openTabs[n - 1]
        if (target) setActiveTab(target)
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
        case 'new-agent-canvas': {
          if (!workspacePath) break
          await createAgentCanvas(useWorkspaceStore.getState().selectedFolder ?? workspacePath)
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
        case 'trash':
          if (workspacePath) openOverlay('trash')
          break
        case 'exit':
          await getCurrentWindow().close()
          break
        case 'search':
          openOverlay('search')
          break
        case 'quick-switch':
          openOverlay('switcher')
          break
        case 'command-palette':
          openOverlay('palette')
          break
        case 'sync-now':
          await syncNow()
          break
        case 'home':
          if (workspacePath) setActiveTab(null)
          break
        case 'toggle-view':
          if (activeTab) setPrimaryViewMode((m) => (m === 'wysiwyg' ? 'raw' : 'wysiwyg'))
          break
        case 'insert-ink':
          window.dispatchEvent(new Event('command:insert-ink'))
          break
        case 'add-property':
          if (!activeTab) break
          setPrimaryViewMode('wysiwyg')
          window.dispatchEvent(new Event('command:add-property'))
          break
        case 'split-tasks':
          // Same shape as insert-ink: the editor instance stays in NoteEditor
          // rather than being lifted here just so a menu item can reach it.
          window.dispatchEvent(new Event('command:split-tasks'))
          break
        case 'format-note':
          window.dispatchEvent(new Event('command:format-note'))
          break
        case 'export-pdf':
          if (!activeTab) break
          // The print stylesheet only styles the rendered view — switch
          // before the dialog opens so it's already correct by the time
          // the user clicks Export.
          setPrimaryViewMode('wysiwyg')
          openOverlay('exportPdf')
          break
        case 'print':
          if (!activeTab) break
          setPrimaryViewMode('wysiwyg')
          openOverlay('print')
          break
        case 'nav-back':
          goBack()
          break
        case 'nav-forward':
          goForward()
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
            setPendingCram(null)
            openOverlay('review')
          }
          break
        case 'deck-view':
          if (workspacePath) openOverlay('deck')
          break
        case 'generate-formula-sheet':
          if (workspacePath) openOverlay('formulaSheet')
          break
        case 'generate-solutions-sheet':
          if (workspacePath) openOverlay('solutionsSheet')
          break
        case 'toggle-terminal':
          if (!workspacePath || mobile || isWeb()) break
          setTerminalMounted(true)
          setTerminalOpen((o) => !o)
          break
        case 'toggle-outline':
          if (activeTab) setOutlineOpen((o) => !o)
          break
        case 'toggle-outgoing-links':
          if (activeTab) setOutgoingLinksOpen((o) => !o)
          break
        case 'close-tab':
          if (activeTab) await requestCloseTab(activeTab)
          break
        case 'toggle-pin-tab':
          if (activeTab) togglePinTab(activeTab)
          break
        case 'reopen-closed-tab':
          reopenClosedTab()
          break
        case 'note-bookmark':
          if (activeTab) useBookmarksStore.getState().toggle({ kind: 'note', path: activeTab })
          break
        case 'note-duplicate':
          if (activeTab) await duplicateNote(activeTab)
          break
        case 'note-merge':
          if (activeTab) requestMerge(activeTab)
          break
        case 'extract-selection':
          window.dispatchEvent(new Event('command:extract-selection'))
          break
        case 'note-move':
          if (activeTab) await moveNoteViaPicker(activeTab)
          break
        case 'note-rename':
          if (activeTab) await renameNote(activeTab)
          break
        case 'note-delete':
          if (activeTab) await deleteNote(activeTab)
          break
        case 'note-reveal':
          if (activeTab) await revealNote(activeTab)
          break
        case 'note-open-external':
          if (activeTab) await openNoteExternally(activeTab)
          break
        case 'note-copy-path':
          if (activeTab) await copyNotePath(activeTab, 'absolute')
          break
        case 'note-copy-relative-path':
          if (activeTab) await copyNotePath(activeTab, 'relative')
          break
        case 'fold-all':
        case 'unfold-all':
          window.dispatchEvent(new Event(`command:${id}`))
          break
        case 'toggle-focus-mode':
          toggleFocusMode()
          break
        case 'toggle-sidebar':
          toggleSidebar()
          break
        case 'zoom-in':
        case 'zoom-out':
        case 'zoom-reset': {
          const current = useSettingsStore.getState().settings
          const uiZoomPct = id === 'zoom-reset' ? 100 : clampZoom(current.uiZoomPct + (id === 'zoom-in' ? 10 : -10))
          const next = { ...current, uiZoomPct }
          setSettings(next)
          void api.settings.save(next)
          break
        }
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
      workspacePath,
      openTabs,
      setActiveTab,
      togglePinTab,
      reopenClosedTab,
      toggleFocusMode,
      toggleSidebar,
      createNote,
      createFolder,
      createCanvasNote,
      createAgentCanvas,
      openWorkspace,
      openWorkspaceAt,
      closeWorkspace,
      openOverlay,
      syncNow,
      requestMerge,
    ],
  )

  const handleFlashcardCommand = useCallback(
    (editor: Editor, range: Range) => {
      setPendingFlashcardInsert({ editor, range })
      openOverlay('flashcard')
    },
    [openOverlay],
  )

  // Skips the picker entirely when there's nothing yet to reuse — same
  // zero-click "just insert" behavior as before #39, until a workspace
  // actually has a diagram worth offering.
  const handleDiagramCommand = useCallback(
    (editor: Editor, range: Range | null) => {
      if (!workspacePath) return
      void diagramApi.list(workspacePath).then((diagrams) => {
        if (diagrams.length === 0) {
          const notePath = editor.storage.noteContext.notePath
          if (range) editor.chain().focus().deleteRange(range).run()
          void insertDiagram(editor, notePath).catch(report)
          return
        }
        setPendingDiagramInsert({ editor, range, diagrams })
        openOverlay('diagramPicker')
      })
    },
    [workspacePath, openOverlay],
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

  // The one keydown dispatcher: every shortcut — rebindable via Settings —
  // resolves through the keymap, so the labels in menus, palette and the
  // shortcut sheet can't drift from what actually fires. Ctrl/Alt/F-key
  // combos are never legitimate note text, but a bare key like the default
  // `?` is, so those are skipped when typing into an editable target. Alt+←/→
  // history navigation rides the same path via nav-back/nav-forward.
  const keymap = useKeymap()
  useEffect(() => {
    const commandByCombo = new Map(Object.entries(keymap).filter(([, combo]) => combo).map(([id, combo]) => [combo, id]))
    function onKey(e: KeyboardEvent) {
      const combo = comboFromEvent(e)
      const commandId = combo && commandByCombo.get(combo)
      if (!commandId) return
      const target = e.target as HTMLElement | null
      if (!isGlobalCombo(combo) && target?.closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      void runCommand(commandId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keymap, runCommand])

  useEffect(() => {
    void api.workspace.initialWorkspace().then(async (path) => {
      if (!path) return
      if (await api.workspace.initialSingleNote()) {
        const file = await api.workspace.initialSelectFile()
        if (file) void openSingleNote(path, file)
        return
      }
      void openWorkspaceAt(path, { remember: false }).then(() => {
        void api.workspace.initialSelectFile().then((file) => {
          if (file) useWorkspaceStore.getState().openTab(file)
        })
      })
    })
    void refreshRecents()
    void api.settings.load().then(setSettings)
  }, [setSettings, openWorkspaceAt, openSingleNote])

  useEffect(() => {
    setPrimaryViewMode('wysiwyg')
  }, [activeTab])

  useEffect(() => {
    void refreshTags()
  }, [activeTab])

  const overlays = (
    <>
      {activeOverlay === 'search' && <SearchModal onClose={closeOverlay} />}
      {activeOverlay === 'switcher' && <QuickSwitcher onClose={closeOverlay} />}
      {activeOverlay === 'mergeTarget' && mergeSource && (
        <QuickSwitcher
          onClose={closeOverlay}
          title="Merge into note"
          exclude={mergeSource}
          onPick={(dest) => void flushThenMerge(mergeSource, dest)}
        />
      )}
      {activeOverlay === 'palette' && (
        <CommandPalette
          hasWorkspace={!!workspacePath}
          hasNote={!!activeTab && !canvasTab}
          tabPinned={activeTabPinned}
          repoMode={!!repoMode}
          onRun={(id) => void runCommand(id)}
          onClose={closeOverlay}
        />
      )}
      {activeOverlay === 'settings' && <SettingsPanel onClose={closeOverlay} />}
      {activeOverlay === 'trash' && <TrashDialog onClose={closeOverlay} />}
      {activeOverlay === 'shortcuts' && <ShortcutsOverlay onClose={closeOverlay} />}
      <PromptDialog />
      <ToastStack />
      <UpdateDialog />
      {activeOverlay === 'template' && <TemplateDialog onClose={closeOverlay} />}
      {activeOverlay === 'graph' && <GraphView onClose={closeOverlay} />}
      {activeOverlay === 'task' && <TaskView onClose={closeOverlay} />}
      {activeOverlay === 'review' && (
        <ReviewSession
          mode={pendingCram ?? { kind: 'due' }}
          onClose={() => {
            setPendingCram(null)
            closeOverlay()
          }}
          onSwitchCategory={(streak, struggling) => setPendingCram({ kind: 'cram', streak, struggling })}
        />
      )}
      {activeOverlay === 'deck' && (
        <DeckView
          onClose={closeOverlay}
          onOpenCram={(streak, struggling) => {
            setPendingCram({ kind: 'cram', streak, struggling })
            openOverlay('review')
          }}
          onOpenTagReview={(tags) => {
            setPendingCram({ kind: 'tags', tags })
            openOverlay('review')
          }}
        />
      )}
      {activeOverlay === 'formulaSheet' && <FormulaSheetPrompt onClose={closeOverlay} />}
      {activeOverlay === 'solutionsSheet' && <FormulaSheetPrompt kind="solutions" onClose={closeOverlay} />}
      <Suspense fallback={null}>
        {activeOverlay === 'exportPdf' && currentNote && (
          <ExportPdfDialog noteTitle={currentNote.title} contentRef={editorPaneRef} onClose={closeOverlay} />
        )}
        {activeOverlay === 'print' && currentNote && (
          <PrintDialog noteTitle={currentNote.title} contentRef={editorPaneRef} onClose={closeOverlay} />
        )}
      </Suspense>
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
      {activeOverlay === 'diagramPicker' && pendingDiagramInsert && (
        <DiagramPickerDialog
          editor={pendingDiagramInsert.editor}
          range={pendingDiagramInsert.range}
          diagrams={pendingDiagramInsert.diagrams}
          onClose={() => {
            setPendingDiagramInsert(null)
            closeOverlay()
          }}
        />
      )}
    </>
  )

  const gitBars = (
    <>
      {gitDiverged && (
        <GitDivergedBar
          ahead={gitDiverged.ahead}
          behind={gitDiverged.behind}
          localPaths={gitDiverged.localPaths}
          remotePaths={gitDiverged.remotePaths}
          onSync={async () => {
            if (!workspacePath) return
            try {
              // #87: queues behind, and is fully awaited before, any other
              // git-mutating call — this can otherwise fire alongside the
              // idle-commit timer, the pull interval, or a focus refresh.
              await withGitLock(() => api.git.rebaseOntoRemote(workspacePath))
            } catch (e) {
              console.error('git rebase-onto-remote failed', e)
            }
            await checkForUpdates(workspacePath)
          }}
          onDismiss={() => useWorkspaceStore.getState().setGitDiverged(null)}
        />
      )}
      {gitPullBlocked && (
        <GitPullBlockedBar
          output={gitPullBlocked.output}
          paths={gitPullBlocked.paths}
          onDismiss={() => useWorkspaceStore.getState().setGitPullBlocked(null)}
        />
      )}
      {gitAhead !== null && (
        <GitAheadBar
          ahead={gitAhead}
          onDismiss={() => useWorkspaceStore.getState().setGitAhead(null)}
        />
      )}
      {repoMode && !gitPrompted && !gitDiverged && !gitPullBlocked && gitAhead === null && (
        <GitAutoCommitPrompt
          mode={repoMode}
          priorAutomation={gitPriorAutomation}
          onEnable={() => void updateGit({ prompted: true, autoCommit: true })}
          onDecline={() => void updateGit({ prompted: true })}
        />
      )}
    </>
  )

  const primaryEditorPane = canvasTab && activeTab ? (
    <ErrorBoundary key={activeTab}>
      <Suspense fallback={null}>
        {isBasePath(activeTab) ? <BasePane path={activeTab} /> : <CanvasPane path={activeTab} />}
      </Suspense>
    </ErrorBoundary>
  ) : (
    <EditorPane
      ref={editorPaneRef}
      scrollRef={scrollRef}
      notePath={activeTab}
      content={content}
      isLoading={isLoading}
      saveState={saveState}
      saveError={saveError}
      onSave={(md) => void save(md)}
      onRetrySave={retrySave}
      onDismissSaveError={dismissError}
      conflict={conflict}
      onKeepMine={keepMine}
      onReloadTheirs={reloadTheirs}
      viewMode={primaryViewMode}
      onViewModeChange={setPrimaryViewMode}
      onFlashcardCommand={handleFlashcardCommand}
      onDiagramCommand={handleDiagramCommand}
      emptyState={{
        onOpenTaskView: () => openOverlay('task'),
        onOpenReview: () => {
          setPendingCram(null)
          openOverlay('review')
        },
        onOpenDeckView: () => openOverlay('deck'),
        onOpenSettings: () => openOverlay('settings'),
        overlayOpen: activeOverlay !== null,
      }}
    />
  )

  if (mobile) {
    return (
      <TooltipProvider>
        <MobileShell
          activeOverlay={activeOverlay}
          openOverlay={openOverlay}
          closeOverlay={closeOverlay}
          onReviewOpen={() => {
            setPendingCram(null)
            openOverlay('review')
          }}
          hasWorkspace={workspacePath !== null}
          noteTitle={currentNote?.title ?? ''}
          home={
            <HomeView
              onOpenTaskView={() => openOverlay('task')}
              onOpenReview={() => {
                setPendingCram(null)
                openOverlay('review')
              }}
              onOpenDeckView={() => openOverlay('deck')}
              onOpenSettings={() => openOverlay('settings')}
              overlayOpen={activeOverlay !== null}
            />
          }
          editor={primaryEditorPane}
          saveStatus={
            <SaveStatus state={saveState} error={saveError} onRetry={() => void retrySave()} onDismiss={dismissError} />
          }
          gitBars={gitBars}
          overlays={overlays}
          onSyncNow={repoMode ? () => void syncNow() : null}
          syncing={syncingNow}
        />
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
    <div className="app-shell">
    <Titlebar title={windowTitle} onCommand={runCommand} recentWorkspaces={recentWorkspaces} />
    <div className="layout">
      {overlays}
      {!focusMode && !singleNote && (
        <Sidebar
          onSearchOpen={() => openOverlay('search')}
          onSettingsOpen={() => openOverlay('settings')}
          onTemplateOpen={() => openOverlay('template')}
          onGraphOpen={() => openOverlay('graph')}
          onTaskOpen={() => openOverlay('task')}
          onReviewOpen={() => {
            setPendingCram(null)
            openOverlay('review')
          }}
          onFormulaSheetOpen={() => openOverlay('formulaSheet')}
          onTerminalToggle={() => {
            setTerminalMounted(true)
            setTerminalOpen((o) => !o)
          }}
        />
      )}
      <main className="main">
        <TabBar
          viewMode={primaryViewMode}
          onToggleView={() => setPrimaryViewMode((m) => (m === 'wysiwyg' ? 'raw' : 'wysiwyg'))}
          saveState={saveState}
          saveError={saveError}
          onRetrySave={() => void retrySave()}
          onDismissSaveError={dismissError}
          gitCommitStatus={gitCommitStatus}
          gitCommitDetail={gitCommitDetail}
          onSyncNow={syncNow}
          syncingNow={syncingNow}
        />
        {gitBars}
        <div className="editor-body">
          <div className="pane-wrapper">
            {primaryEditorPane}
            {!canvasTab && !isLoading && activeTab && primaryViewMode === 'wysiwyg' && outlineOpen && (
              <OutlinePanel content={content} containerRef={editorPaneRef} />
            )}
            {!canvasTab && !isLoading && activeTab && primaryViewMode === 'wysiwyg' && outgoingLinksOpen && (
              <OutgoingLinksPanel content={content} notePath={activeTab} />
            )}
          </div>
        </div>
        {terminalMounted && workspacePath && (
          <Suspense fallback={null}>
            <TerminalPane
              workspace={workspacePath}
              notePath={activeTab}
              hidden={!terminalOpen}
              onClose={() => setTerminalOpen(false)}
            />
          </Suspense>
        )}
      </main>
    </div>
    </div>
    </TooltipProvider>
  )
}
