import { useEffect, useRef } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { NoteList } from './NoteList'
import { TagList } from './TagList'
import { SidebarHeader } from './SidebarHeader'
import { SidebarRail } from './SidebarRail'
import { isMobile } from '../lib/platform'
import { useMobileSidebarStore } from '../store/mobileSidebar'

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
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const collapsed = useWorkspaceStore((s) => s.sidebarCollapsed)
  const mobile = isMobile()
  const drawerOpen = useMobileSidebarStore((s) => s.open)
  const closeDrawer = useMobileSidebarStore((s) => s.close)

  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (mobile) closeDrawer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  function closeIfMobile() {
    if (mobile) closeDrawer()
  }

  const railProps = {
    onSearchOpen,
    onSettingsOpen,
    onGraphOpen,
    onTaskOpen,
    onReviewOpen,
    onFormulaSheetOpen,
    onTerminalToggle,
    afterAction: closeIfMobile,
  }
  const classes = ['sidebar']
  if (mobile) classes.push('sidebar--drawer', ...(drawerOpen ? ['sidebar--open'] : []))
  else if (collapsed) classes.push('sidebar--collapsed')

  return (
    <aside className={classes.join(' ')}>
      {!mobile && <SidebarRail {...railProps} />}
      <div className="sidebar-panel" inert={!mobile && collapsed}>
        <SidebarHeader onSearchOpen={onSearchOpen} onTemplateOpen={onTemplateOpen} afterAction={closeIfMobile} />
        <NoteList />
        <TagList />
        {mobile && <SidebarRail bar {...railProps} />}
      </div>
    </aside>
  )
}
