import { X } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
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
}

export function TabBar({
  viewMode,
  onToggleView,
  saveState,
  saveError,
  onRetrySave,
  onDismissSaveError,
  gitCommitStatus,
}: TabBarProps) {
  const { openTabs, activeTab, setActiveTab, closeTab, flashTabPath, setFlashTabPath } =
    useWorkspaceStore()
  if (openTabs.length === 0) return null
  return (
    <div className="tab-bar" role="tablist">
      {openTabs.map((path) => {
        const name = path.split(/[\\/]/).pop()?.replace('.md', '') ?? path
        const isActive = path === activeTab
        const isFlashing = path === flashTabPath
        return (
          <div
            key={path}
            role="tab"
            aria-selected={isActive}
            className={`tab${isActive ? ' active' : ''}${isFlashing ? ' tab-flash' : ''}`}
            onAnimationEnd={() => {
              if (isFlashing) setFlashTabPath(null)
            }}
          >
            <button onClick={() => setActiveTab(path)}>{name}</button>
            <button className="tab-close" onClick={() => closeTab(path)} aria-label={`Close ${name}`}>
              <X size={12} />
            </button>
          </div>
        )
      })}
      {activeTab && (
        <>
          <SaveStatus
            state={saveState}
            error={saveError}
            onRetry={onRetrySave}
            onDismiss={onDismissSaveError}
          />
          <GitCommitStatus status={gitCommitStatus} />
          <button
            className={`view-toggle${viewMode === 'raw' ? ' active' : ''}`}
            onClick={onToggleView}
            title={viewMode === 'wysiwyg' ? 'View source' : 'View preview'}
          >
            {viewMode === 'wysiwyg' ? 'Source' : 'Preview'}
          </button>
        </>
      )}
    </div>
  )
}
