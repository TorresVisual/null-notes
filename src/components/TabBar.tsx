import { X } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { SaveStatus } from './SaveStatus'
import type { SaveState } from '../hooks/useNote'

interface TabBarProps {
  viewMode: 'wysiwyg' | 'raw'
  onToggleView: () => void
  saveState: SaveState
  saveError: string | null
  onRetrySave: () => void
  onDismissSaveError: () => void
}

export function TabBar({
  viewMode,
  onToggleView,
  saveState,
  saveError,
  onRetrySave,
  onDismissSaveError,
}: TabBarProps) {
  const { openTabs, activeTab, setActiveTab, closeTab } = useWorkspaceStore()
  if (openTabs.length === 0) return null
  return (
    <div className="tab-bar" role="tablist">
      {openTabs.map((path) => {
        const name = path.split(/[\\/]/).pop()?.replace('.md', '') ?? path
        const isActive = path === activeTab
        return (
          <div
            key={path}
            role="tab"
            aria-selected={isActive}
            className={`tab${isActive ? ' active' : ''}`}
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
