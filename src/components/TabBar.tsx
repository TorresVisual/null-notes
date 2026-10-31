import { useState } from 'react'
import { ChevronLeft, ChevronRight, Pin, RefreshCw, X } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore, noteTitle } from '../store/notes'
import { requestCloseTab } from '../lib/requestCloseTab'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu'
import { SaveStatus } from './SaveStatus'
import { GitCommitStatus } from './GitCommitStatus'
import { goBack, goForward, useNavigationHistoryStore } from '../lib/navigationHistory'
import type { SaveState } from '../hooks/useNote'
import type { GitCommitStatus as GitStatus } from '../types'

interface TabBarProps {
  viewMode: 'wysiwyg' | 'raw'
  onToggleView: () => void
  saveState: SaveState
  saveError: string | null
  onRetrySave: () => void
  onDismissSaveError: () => void
  gitCommitStatus: GitStatus
  gitCommitDetail: string | null
  onSyncNow: () => void
  syncingNow: boolean
}

export function TabBar({
  viewMode,
  onToggleView,
  saveState,
  saveError,
  onRetrySave,
  onDismissSaveError,
  gitCommitStatus,
  gitCommitDetail,
  onSyncNow,
  syncingNow,
}: TabBarProps) {
  const { openTabs, pinnedTabs, activeTab, setActiveTab, togglePinTab, flashTabPath, setFlashTabPath, reorderTabs } =
    useWorkspaceStore()
  const repoMode = useWorkspaceStore((s) => s.repoMode)
  const autoCommit = useWorkspaceStore((s) => s.git.autoCommit)
  const notes = useNotesStore((s) => s.notes)
  const { canGoBack, canGoForward } = useNavigationHistoryStore()
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  if (openTabs.length === 0) return null
  return (
    <div className="tab-bar" role="tablist">
      <div className="nav-history">
        <button onClick={goBack} disabled={!canGoBack} title="Back (Alt+Left)" aria-label="Back">
          <ChevronLeft size={14} />
        </button>
        <button onClick={goForward} disabled={!canGoForward} title="Forward (Alt+Right)" aria-label="Forward">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="tab-bar-tabs">
        {openTabs.map((path) => {
          const name = noteTitle(notes, path)
          const isActive = path === activeTab
          const isFlashing = path === flashTabPath
          const isPinned = pinnedTabs.includes(path)
          return (
            <ContextMenu key={path}>
            <ContextMenuTrigger asChild>
            <div
              role="tab"
              aria-selected={isActive}
              draggable
              className={`tab${isActive ? ' active' : ''}${isPinned ? ' pinned' : ''}${isFlashing ? ' tab-flash' : ''}${draggedPath === path ? ' tab-dragging' : ''}`}
              onAnimationEnd={() => {
                if (isFlashing) setFlashTabPath(null)
              }}
              onDragStart={(e) => {
                setDraggedPath(path)
                e.dataTransfer.setData('text/plain', path)
              }}
              onDragEnd={() => setDraggedPath(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (draggedPath) reorderTabs(draggedPath, path)
                setDraggedPath(null)
              }}
            >
              {isPinned && <Pin size={11} className="tab-pin-glyph" aria-hidden />}
              <button onClick={() => setActiveTab(path)} title={name}>{name}</button>
              <button className="tab-close" onClick={() => void requestCloseTab(path)} aria-label={`Close ${name}`}>
                <X size={12} />
              </button>
            </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="context-menu">
              <ContextMenuItem onSelect={() => togglePinTab(path)}>
                {isPinned ? 'Unpin tab' : 'Pin tab'}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => void requestCloseTab(path)}>Close tab</ContextMenuItem>
            </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
      {activeTab && (
        <div className="tab-bar-status">
          <SaveStatus
            state={saveState}
            error={saveError}
            onRetry={onRetrySave}
            onDismiss={onDismissSaveError}
          />
          <GitCommitStatus status={gitCommitStatus} detail={gitCommitDetail} />
          {repoMode && (
            <button
              className="git-sync-now"
              onClick={onSyncNow}
              disabled={syncingNow}
              title="Commit, push, and pull now"
            >
              <RefreshCw size={12} className={syncingNow ? 'spin' : ''} />
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
          <button
            className={`view-toggle${viewMode === 'raw' ? ' active' : ''}`}
            onClick={onToggleView}
            title={viewMode === 'wysiwyg' ? 'View source' : 'View preview'}
          >
            {viewMode === 'wysiwyg' ? 'Source' : 'Preview'}
          </button>
        </div>
      )}
    </div>
  )
}
