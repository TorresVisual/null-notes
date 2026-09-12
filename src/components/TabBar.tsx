import { useState } from 'react'
import { X } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore, noteTitle } from '../store/notes'
import { SaveStatus } from './SaveStatus'
import { GitCommitStatus } from './GitCommitStatus'
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
}: TabBarProps) {
  const { openTabs, activeTab, setActiveTab, closeTab, flashTabPath, setFlashTabPath, reorderTabs } =
    useWorkspaceStore()
  const repoMode = useWorkspaceStore((s) => s.repoMode)
  const autoCommit = useWorkspaceStore((s) => s.git.autoCommit)
  const notes = useNotesStore((s) => s.notes)
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  if (openTabs.length === 0) return null
  return (
    <div className="tab-bar" role="tablist">
      <div className="tab-bar-tabs">
        {openTabs.map((path) => {
          const name = noteTitle(notes, path)
          const isActive = path === activeTab
          const isFlashing = path === flashTabPath
          return (
            <div
              key={path}
              role="tab"
              aria-selected={isActive}
              draggable
              className={`tab${isActive ? ' active' : ''}${isFlashing ? ' tab-flash' : ''}${draggedPath === path ? ' tab-dragging' : ''}`}
              onAnimationEnd={() => {
                if (isFlashing) setFlashTabPath(null)
              }}
              onDragStart={() => setDraggedPath(path)}
              onDragEnd={() => setDraggedPath(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (draggedPath) reorderTabs(draggedPath, path)
                setDraggedPath(null)
              }}
            >
              <button onClick={() => setActiveTab(path)} title={name}>{name}</button>
              <button className="tab-close" onClick={() => closeTab(path)} aria-label={`Close ${name}`}>
                <X size={12} />
              </button>
            </div>
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
