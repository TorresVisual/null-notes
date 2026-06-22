import { useWorkspaceStore } from '../store/workspace'

export function TabBar() {
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
            <button onClick={() => closeTab(path)} aria-label={`Close ${name}`}>
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
