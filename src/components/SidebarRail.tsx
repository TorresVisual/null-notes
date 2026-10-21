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
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

interface RailItem {
  label: string
  icon: LucideIcon
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
}

interface SidebarRailProps {
  // The mobile drawer shows the same buttons as a horizontal bar instead of a
  // vertical rail, and has no panel to collapse.
  bar?: boolean
  onSearchOpen: () => void
  onSettingsOpen: () => void
  onGraphOpen: () => void
  onTaskOpen: () => void
  onReviewOpen: () => void
  onFormulaSheetOpen: () => void
  onTerminalToggle: () => void
  afterAction: () => void
}

function RailButton({ item, side }: { item: RailItem; side: 'right' | 'top' }) {
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
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>
        {item.label}
        {item.shortcut && <kbd>{item.shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

export function SidebarRail({
  bar = false,
  onSearchOpen,
  onSettingsOpen,
  onGraphOpen,
  onTaskOpen,
  onReviewOpen,
  onFormulaSheetOpen,
  onTerminalToggle,
  afterAction,
}: SidebarRailProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const sidebarCollapsed = useWorkspaceStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar)
  const noWorkspace = !workspacePath

  function run(action: () => void) {
    return () => {
      action()
      afterAction()
    }
  }

  const home: RailItem = {
    label: 'Home',
    icon: Home,
    shortcut: 'Ctrl H',
    onClick: run(() => setActiveTab(null)),
    disabled: noWorkspace,
  }
  const search: RailItem = { label: 'Search', icon: Search, shortcut: 'Ctrl K', onClick: run(onSearchOpen) }
  const settings: RailItem = { label: 'Settings', icon: Settings, shortcut: 'Ctrl ,', onClick: run(onSettingsOpen) }
  const features: RailItem[] = [
    { label: 'Tasks', icon: ListChecks, shortcut: 'Ctrl Shift K', onClick: run(onTaskOpen), disabled: noWorkspace },
    { label: 'Graph view', icon: Network, shortcut: 'Ctrl G', onClick: run(onGraphOpen), disabled: noWorkspace },
    { label: 'Review', icon: GraduationCap, shortcut: 'Ctrl Shift R', onClick: run(onReviewOpen), disabled: noWorkspace },
    { label: 'Generate formula sheet', icon: Sigma, onClick: run(onFormulaSheetOpen), disabled: noWorkspace },
  ]
  const terminal: RailItem = {
    label: 'Terminal',
    icon: SquareTerminal,
    shortcut: 'Ctrl `',
    onClick: run(onTerminalToggle),
    disabled: noWorkspace,
  }

  if (bar) {
    return (
      <nav className="sidebar-rail sidebar-rail--bar" aria-label="Quick actions">
        {[home, search, ...features, settings].map((item) => (
          <RailButton key={item.label} item={item} side="top" />
        ))}
      </nav>
    )
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
      {[files, search, ...features, terminal].map((item) => (
        <RailButton key={item.label} item={item} side="right" />
      ))}
      <div className="sidebar-rail-end">
        <RailButton item={home} side="right" />
        <RailButton item={settings} side="right" />
      </div>
    </nav>
  )
}
