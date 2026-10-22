import { useWorkspaceStore } from '../store/workspace'
import { NoteList } from './NoteList'
import { TagList } from './TagList'
import { SidebarHeader } from './SidebarHeader'
import { SidebarRail } from './SidebarRail'

interface SidebarProps {
  onSearchOpen: () => void
  onSettingsOpen: () => void
  onTemplateOpen: () => void
  onGraphOpen: () => void
  onTaskOpen: () => void
  onReviewOpen: () => void
  onFormulaSheetOpen: () => void
  onTerminalToggle: () => void
}

export function Sidebar({
  onSearchOpen,
  onSettingsOpen,
  onTemplateOpen,
  onGraphOpen,
  onTaskOpen,
  onReviewOpen,
  onFormulaSheetOpen,
  onTerminalToggle,
}: SidebarProps) {
  const collapsed = useWorkspaceStore((s) => s.sidebarCollapsed)

  const railProps = {
    onSearchOpen,
    onSettingsOpen,
    onGraphOpen,
    onTaskOpen,
    onReviewOpen,
    onFormulaSheetOpen,
    onTerminalToggle,
  }
  const classes = ['sidebar']
  if (collapsed) classes.push('sidebar--collapsed')

  return (
    <aside className={classes.join(' ')}>
      <SidebarRail {...railProps} />
      <div className="sidebar-panel" inert={collapsed}>
        <SidebarHeader onSearchOpen={onSearchOpen} onTemplateOpen={onTemplateOpen} />
        <NoteList />
        <TagList />
      </div>
    </aside>
  )
}
