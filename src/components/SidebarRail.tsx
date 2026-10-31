import {
  Files,
  GraduationCap,
  Home,
  ListChecks,
  Network,
  Search,
  Settings,
  Sigma,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { useUpdateStore } from '../store/update'
import { isWeb } from '../lib/platform'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

interface RailItem {
  label: string
  icon: LucideIcon
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  badge?: boolean
}

interface SidebarRailProps {
  onSearchOpen: () => void
  onSettingsOpen: () => void
  onGraphOpen: () => void
  onTaskOpen: () => void
  onReviewOpen: () => void
  onFormulaSheetOpen: () => void
  onTerminalToggle: () => void
}

function RailButton({ item }: { item: RailItem }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={`rail-btn${item.pressed ? ' is-active' : ''}`}
          onClick={item.onClick}
          disabled={item.disabled}
          aria-label={item.label}
          aria-pressed={item.pressed}
        >
          <item.icon size={16} />
          {item.badge && <span className="rail-badge" aria-hidden />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {item.shortcut && <kbd>{item.shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

export function SidebarRail({
  onSearchOpen,
  onSettingsOpen,
  onGraphOpen,
  onTaskOpen,
  onReviewOpen,
  onFormulaSheetOpen,
  onTerminalToggle,
}: SidebarRailProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const sidebarCollapsed = useWorkspaceStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar)
  const noWorkspace = !workspacePath
  const updateAvailable = useUpdateStore((s) => s.update !== null)

  const home: RailItem = {
    label: 'Home',
    icon: Home,
    shortcut: 'Ctrl H',
    onClick: () => setActiveTab(null),
    disabled: noWorkspace,
  }
  const search: RailItem = { label: 'Search', icon: Search, shortcut: 'Ctrl K', onClick: onSearchOpen }
  const settings: RailItem = {
    label: updateAvailable ? 'Settings — update available' : 'Settings',
    icon: Settings,
    shortcut: 'Ctrl ,',
    onClick: onSettingsOpen,
    badge: updateAvailable,
  }
  const features: RailItem[] = [
    { label: 'Tasks', icon: ListChecks, shortcut: 'Ctrl Shift K', onClick: onTaskOpen, disabled: noWorkspace },
    { label: 'Graph view', icon: Network, shortcut: 'Ctrl G', onClick: onGraphOpen, disabled: noWorkspace },
    { label: 'Review', icon: GraduationCap, shortcut: 'Ctrl Shift R', onClick: onReviewOpen, disabled: noWorkspace },
    { label: 'Generate formula sheet', icon: Sigma, onClick: onFormulaSheetOpen, disabled: noWorkspace },
  ]
  const terminal: RailItem = {
    label: 'Terminal',
    icon: SquareTerminal,
    shortcut: 'Ctrl `',
    onClick: onTerminalToggle,
    disabled: noWorkspace,
  }

  const files: RailItem = {
    label: 'Toggle sidebar',
    icon: Files,
    shortcut: 'Ctrl \\',
    onClick: toggleSidebar,
    pressed: !sidebarCollapsed,
  }

  return (
    <nav className="sidebar-rail" aria-label="Quick actions">
      {[files, search, ...features, ...(isWeb() ? [] : [terminal])].map((item) => (
        <RailButton key={item.label} item={item} />
      ))}
      <div className="sidebar-rail-end">
        <RailButton item={home} />
        <RailButton item={settings} />
      </div>
    </nav>
  )
}
