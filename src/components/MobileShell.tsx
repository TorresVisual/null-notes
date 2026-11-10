import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { useMobileEditStore } from '../store/mobileEdit'
import { useBackButton } from '../hooks/useBackButton'
import type { OverlayKind } from '../hooks/useOverlayManager'
import type { MobileTab } from '../lib/backNavigation'
import { MobileTabBar, type TabId } from './MobileTabBar'
import { MoreSheet } from './MoreSheet'
import { MobileNotes } from './MobileNotes'

interface MobileShellProps {
  activeOverlay: OverlayKind | null
  openOverlay: (kind: OverlayKind) => void
  closeOverlay: () => void
  onReviewOpen: () => void
  hasWorkspace: boolean
  noteTitle: string
  home: ReactNode
  editor: ReactNode
  saveStatus: ReactNode
  gitBars: ReactNode
  overlays: ReactNode
  onSyncNow: (() => void) | null
  syncing: boolean
}

function highlightedTab(tab: MobileTab, moreOpen: boolean, overlay: OverlayKind | null): TabId {
  if (moreOpen) return 'more'
  if (overlay === 'search') return 'search'
  if (overlay === 'review' || overlay === 'deck') return 'review'
  return tab
}

export function MobileShell({
  activeOverlay,
  openOverlay,
  closeOverlay,
  onReviewOpen,
  hasWorkspace,
  noteTitle,
  home,
  editor,
  saveStatus,
  gitBars,
  overlays,
  onSyncNow,
  syncing,
}: MobileShellProps) {
  const [tab, setTab] = useState<MobileTab>('home')
  const [moreOpen, setMoreOpen] = useState(false)
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const editorOpen = hasWorkspace && activeTab !== null

  // Dialogs portal to <body>, outside .app-shell, so full-screen overlay CSS
  // keys off the root element rather than a wrapper class.
  useEffect(() => {
    document.documentElement.dataset.shell = 'mobile'
    return () => {
      delete document.documentElement.dataset.shell
    }
  }, [])

  function closeEditor() {
    useMobileEditStore.getState().stopEditing()
    setActiveTab(null)
  }

  useBackButton(
    { overlayOpen: activeOverlay !== null, sheetOpen: moreOpen, editorOpen, tab },
    {
      'close-overlay': closeOverlay,
      'close-sheet': () => setMoreOpen(false),
      'close-editor': closeEditor,
      'go-home': () => setTab('home'),
    },
  )

  function selectTab(id: TabId) {
    if (id === 'search') openOverlay('search')
    else if (id === 'review') onReviewOpen()
    else if (id === 'more') setMoreOpen(true)
    else setTab(id)
  }

  function selectFromSheet(kind: OverlayKind) {
    setMoreOpen(false)
    openOverlay(kind)
  }

  const screen = !hasWorkspace ? editor : tab === 'notes'
    ? <MobileNotes onSearchOpen={() => openOverlay('search')} onTemplateOpen={() => openOverlay('template')} />
    : home

  return (
    <div className="app-shell mobile-shell">
      {overlays}
      {editorOpen ? (
        <>
          <header className="mobile-topbar">
            <button className="mobile-topbar-back" aria-label="Back" onClick={closeEditor}>
              <ArrowLeft size={20} />
            </button>
            <span className="mobile-topbar-title">{noteTitle}</span>
            {saveStatus}
          </header>
          {gitBars}
          <main className="mobile-screen mobile-screen--editor">{editor}</main>
        </>
      ) : (
        <>
          <main className="mobile-screen">{screen}</main>
          {hasWorkspace && (
            <MobileTabBar
              active={highlightedTab(tab, moreOpen, activeOverlay)}
              hasWorkspace
              onSelect={selectTab}
            />
          )}
        </>
      )}
      {moreOpen && (
        <MoreSheet
          onClose={() => setMoreOpen(false)}
          onSelect={selectFromSheet}
          onSyncNow={onSyncNow}
          syncing={syncing}
        />
      )}
    </div>
  )
}
