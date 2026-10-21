import { useEffect, useRef, useState } from 'react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { FolderTree } from './FolderTree'
import { TagList } from './TagList'
import { SidebarHeader } from './SidebarHeader'
import { SidebarRail } from './SidebarRail'
import { buildFolderTree } from '../lib/folderTree'
import { api } from '../lib/tauri'
import type { NoteMetadata } from '../types'
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
  const notes = useNotesStore((s) => s.notes)
  const folders = useNotesStore((s) => s.folders)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const tagFilter = useWorkspaceStore((s) => s.tagFilter)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const folderError = useWorkspaceStore((s) => s.folderError)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const collapsed = useWorkspaceStore((s) => s.sidebarCollapsed)
  const [tagFilteredNotes, setTagFilteredNotes] = useState<NoteMetadata[]>([])
  const mobile = isMobile()
  const drawerOpen = useMobileSidebarStore((s) => s.open)
  const closeDrawer = useMobileSidebarStore((s) => s.close)

  useEffect(() => {
    if (!tagFilter || !workspacePath) {
      setTagFilteredNotes([])
      return
    }
    let stale = false
    api.notes
      .notesWithTag(workspacePath, tagFilter)
      .then((found) => {
        if (!stale) setTagFilteredNotes(found)
      })
      .catch((err) => {
        if (stale) return
        setTagFilteredNotes([])
        setFolderError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      stale = true
    }
  }, [tagFilter, workspacePath, setFolderError])

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

  const tree = workspacePath ? buildFolderTree(workspacePath, folders, notes) : []
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
        {folderError && <p className="sidebar-error" role="alert">{folderError}</p>}
        {tagFilter ? (
          <ul className="folder-tree">
            {tagFilteredNotes.map((note) => (
              <li
                key={note.path}
                className="tree-row tree-note"
                tabIndex={0}
                onClick={() => openTab(note.path)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  openTab(note.path)
                }}
              >
                <span className="tree-label" title={note.title}>{note.title}</span>
              </li>
            ))}
          </ul>
        ) : workspacePath && tree.length === 0 ? (
          <p className="sidebar-onboarding">
            No notes yet — click <strong>+</strong> above, or Ctrl N, to create your first one.
          </p>
        ) : (
          <FolderTree entries={tree} />
        )}
        <TagList />
        {mobile && <SidebarRail bar {...railProps} />}
      </div>
    </aside>
  )
}
