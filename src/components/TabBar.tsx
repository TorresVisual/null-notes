import { useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, Pin, RefreshCw, X } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore, noteTitle } from '../store/notes'
import { requestCloseTab } from '../lib/requestCloseTab'
import { TAB_DRAG_MIME } from '../lib/dropZone'
import { folderName, isUnderPath, noteFolderSegments } from '../lib/pathPrefix'
import { isBasePath, isCanvasPath } from '../lib/canvasPath'
import type { SplitSide } from '../lib/editorGroups'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from './ui/context-menu'
import { NoteContextMenuItems } from './NoteContextMenuItems'
import { SaveStatus } from './SaveStatus'
import { GitCommitStatus } from './GitCommitStatus'
import { goBack, goForward, useNavigationHistoryStore } from '../lib/navigationHistory'
import type { SaveState } from '../hooks/useNote'
import type { GitCommitStatus as GitStatus } from '../types'

const NO_TABS: string[] = []

const SPLIT_ITEMS: { side: SplitSide; label: string }[] = [
  { side: 'right', label: 'Split Right' },
  { side: 'left', label: 'Split Left' },
  { side: 'up', label: 'Split Up' },
  { side: 'down', label: 'Split Down' },
]

const TAB_KEY_STEP: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }

function moveTabFocus(e: KeyboardEvent<HTMLButtonElement>) {
  const tabs = [...e.currentTarget.closest('[role="tablist"]')!.querySelectorAll<HTMLElement>('[role="tab"]')]
  const here = tabs.indexOf(e.currentTarget)
  const step = TAB_KEY_STEP[e.key]
  const target =
    e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : step ? tabs[(here + step + tabs.length) % tabs.length] : undefined
  if (!target) return
  e.preventDefault()
  target.focus()
  target.click()
}

export interface TabBarStatus {
  saveState: SaveState
  saveError: string | null
  onRetrySave: () => void
  onDismissSaveError: () => void
  gitCommitStatus: GitStatus
  gitCommitDetail: string | null
  onSyncNow: () => void
  syncingNow: boolean
}

interface TabBarProps {
  group: number
  // Present only on the first group's bar: save state, git status, sync and
  // history arrows are workspace-wide and stay in one stable place.
  status?: TabBarStatus
}

export function TabBar({ group, status }: TabBarProps) {
  const { flashTabPath, setFlashTabPath, togglePinTab, reorderTabs, activateTabIn, setGroupViewMode, splitEditor } =
    useWorkspaceStore()
  const canSplit = useWorkspaceStore((s) => s.layout.groups.length < 2)
  const openTabs = useWorkspaceStore((s) => s.layout.groups[group]?.tabs ?? NO_TABS)
  const pinnedTabs = useWorkspaceStore((s) => s.layout.groups[group]?.pinned ?? NO_TABS)
  const activeTab = useWorkspaceStore((s) => s.layout.groups[group]?.active ?? null)
  const viewMode = useWorkspaceStore((s) => s.layout.groups[group]?.viewMode ?? 'wysiwyg')
  const workspacePath = useWorkspaceStore((s) => s.path)
  const repoMode = useWorkspaceStore((s) => s.repoMode)
  const autoCommit = useWorkspaceStore((s) => s.git.autoCommit)
  const notes = useNotesStore((s) => s.notes)
  const { canGoBack, canGoForward } = useNavigationHistoryStore()
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  if (openTabs.length === 0) return null
  const trail =
    activeTab && workspacePath && isUnderPath(activeTab, workspacePath)
      ? [folderName(workspacePath), ...noteFolderSegments(activeTab, workspacePath)]
      : []
  return (
    <>
    <div className="tab-bar">
      <div className="tab-bar-tabs" role="tablist" aria-label="Open notes">
        {openTabs.map((path) => {
          const name = noteTitle(notes, path)
          const isActive = path === activeTab
          const isFlashing = path === flashTabPath
          const isPinned = pinnedTabs.includes(path)
          return (
            <ContextMenu key={path}>
            <ContextMenuTrigger asChild>
            <div
              role="presentation"
              draggable
              className={`tab${isActive ? ' active' : ''}${isPinned ? ' pinned' : ''}${isFlashing ? ' tab-flash' : ''}${draggedPath === path ? ' tab-dragging' : ''}`}
              onAnimationEnd={() => {
                if (isFlashing) setFlashTabPath(null)
              }}
              onDragStart={(e) => {
                setDraggedPath(path)
                e.dataTransfer.setData('text/plain', path)
                e.dataTransfer.setData(TAB_DRAG_MIME, path)
              }}
              onDragEnd={() => setDraggedPath(null)}
              onDragOver={(e) => {
                e.preventDefault()
                if (draggedPath) e.stopPropagation()
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (!draggedPath) return
                e.stopPropagation()
                reorderTabs(draggedPath, path)
                setDraggedPath(null)
              }}
            >
              {isPinned && <Pin size={11} className="tab-pin-glyph" aria-hidden />}
              <button
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => activateTabIn(path, group)}
                onKeyDown={moveTabFocus}
                title={name}
              >
                {name}
              </button>
              <button
                className="tab-close"
                tabIndex={isActive ? 0 : -1}
                onClick={() => void requestCloseTab(path, group)}
                aria-label={`Close ${name}`}
              >
                <X size={12} />
              </button>
            </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="context-menu">
              <ContextMenuItem onSelect={() => togglePinTab(path)}>
                {isPinned ? 'Unpin tab' : 'Pin tab'}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => void requestCloseTab(path, group)}>Close tab</ContextMenuItem>
              <ContextMenuSeparator />
              {SPLIT_ITEMS.map(({ side, label }) => (
                <ContextMenuItem
                  key={side}
                  disabled={!canSplit || isCanvasPath(path) || isBasePath(path)}
                  onSelect={() => {
                    activateTabIn(path, group)
                    splitEditor(side)
                  }}
                >
                  {label}
                </ContextMenuItem>
              ))}
              <ContextMenuSeparator />
              <NoteContextMenuItems path={path} />
            </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
    </div>
    <div className="nav-bar">
      {status && (
        <div className="nav-history">
          <button onClick={goBack} disabled={!canGoBack} title="Back (Alt+Left)" aria-label="Back">
            <ChevronLeft size={16} />
          </button>
          <button onClick={goForward} disabled={!canGoForward} title="Forward (Alt+Right)" aria-label="Forward">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
      {trail.length > 0 && (
        <nav className="breadcrumb" aria-label="Note location">
          {trail.map((segment, i) => (
            <span key={i}>
              {i > 0 && <span className="breadcrumb-sep" aria-hidden>/</span>}
              {segment}
            </span>
          ))}
        </nav>
      )}
      {activeTab && (
        <div className="tab-bar-status">
          {status && (
            <>
              <SaveStatus
                state={status.saveState}
                error={status.saveError}
                onRetry={status.onRetrySave}
                onDismiss={status.onDismissSaveError}
              />
              <GitCommitStatus status={status.gitCommitStatus} detail={status.gitCommitDetail} />
              {repoMode && (
                <button
                  className="git-sync-now"
                  onClick={status.onSyncNow}
                  disabled={status.syncingNow}
                  title="Commit, push, and pull now"
                >
                  <RefreshCw size={12} className={status.syncingNow ? 'spin' : ''} />
                  Sync now
                </button>
              )}
              {repoMode && !autoCommit && (
                <span
                  className="git-commit-status"
                  title="This machine isn't auto-committing this workspace — enable it in Settings to keep it in sync with other machines."
                >
                  Auto-commit off
                </span>
              )}
            </>
          )}
          <button
            className={`view-toggle${viewMode === 'raw' ? ' active' : ''}`}
            onClick={() => setGroupViewMode(group, viewMode === 'wysiwyg' ? 'raw' : 'wysiwyg')}
            title={viewMode === 'wysiwyg' ? 'View source' : 'View preview'}
          >
            {viewMode === 'wysiwyg' ? 'Source' : 'Preview'}
          </button>
        </div>
      )}
    </div>
    </>
  )
}
