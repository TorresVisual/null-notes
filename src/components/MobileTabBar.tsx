import { Home, FolderTree, Search, GraduationCap, Menu, type LucideIcon } from 'lucide-react'

export type TabId = 'home' | 'notes' | 'search' | 'review' | 'more'

interface TabSpec {
  id: TabId
  label: string
  icon: LucideIcon
  needsWorkspace: boolean
}

const TABS: TabSpec[] = [
  { id: 'home', label: 'Home', icon: Home, needsWorkspace: false },
  { id: 'notes', label: 'Notes', icon: FolderTree, needsWorkspace: false },
  { id: 'search', label: 'Search', icon: Search, needsWorkspace: true },
  { id: 'review', label: 'Review', icon: GraduationCap, needsWorkspace: true },
  { id: 'more', label: 'More', icon: Menu, needsWorkspace: false },
]

interface MobileTabBarProps {
  active: TabId
  hasWorkspace: boolean
  onSelect: (id: TabId) => void
}

export function MobileTabBar({ active, hasWorkspace, onSelect }: MobileTabBarProps) {
  return (
    <nav className="mobile-tabbar" aria-label="Main">
      {TABS.map(({ id, label, icon: Icon, needsWorkspace }) => (
        <button
          key={id}
          className={`mobile-tab${id === active ? ' is-active' : ''}`}
          aria-current={id === active ? 'page' : undefined}
          disabled={needsWorkspace && !hasWorkspace}
          onClick={() => onSelect(id)}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
