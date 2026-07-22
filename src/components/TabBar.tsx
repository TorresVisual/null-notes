import { X } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'

interface TabBarProps {
  viewMode: 'wysiwyg' | 'raw'
  onToggleView: () => void
}

export function TabBar({ viewMode, onToggleView }: TabBarProps) {
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
        <button
          className={`view-toggle${viewMode === 'raw' ? ' active' : ''}`}
          onClick={onToggleView}
          title={viewMode === 'wysiwyg' ? 'View source' : 'View preview'}
        >
          {viewMode === 'wysiwyg' ? 'Source' : 'Preview'}
        </button>
      )}
    </div>
  )
}
