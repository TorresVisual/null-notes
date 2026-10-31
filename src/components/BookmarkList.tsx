import { useState } from 'react'
import { ChevronRight, FileText, Folder, Hash, Search } from 'lucide-react'
import { bookmarkLabel, sectionBookmarks, type Bookmark } from '../lib/bookmarks'
import { setPendingHighlight } from '../lib/pendingHighlight'
import { setPendingSearch } from '../lib/pendingSearch'
import { noteTitle, useNotesStore } from '../store/notes'
import { promptText } from '../store/promptDialog'
import { useBookmarksStore } from '../store/bookmarks'
import { useWorkspaceStore } from '../store/workspace'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu'

const ICONS = { note: FileText, heading: Hash, folder: Folder, search: Search }
const DRAG_TYPE = 'text/bookmark-index'

interface BookmarkListProps {
  onSearchOpen: () => void
}

export function BookmarkList({ onSearchOpen }: BookmarkListProps) {
  const items = useBookmarksStore((s) => s.items)
  const { remove, setGroup, move } = useBookmarksStore.getState()
  const notes = useNotesStore((s) => s.notes)
  const folders = useNotesStore((s) => s.folders)
  const workspace = useWorkspaceStore((s) => s.path)
  const { openTab, expandFolder, setSelectedFolder } = useWorkspaceStore.getState()
  const [collapsed, setCollapsed] = useState(false)

  if (items.length === 0) return null

  // Before the first scan lands nothing is known, so nothing is called missing.
  const scanned = notes.length > 0 || folders.length > 0
  const isMissing = (b: Bookmark) =>
    scanned &&
    b.kind !== 'search' &&
    !(b.kind === 'folder' ? folders.includes(b.path) : notes.some((n) => n.path === b.path))

  function open(b: Bookmark) {
    if (b.kind === 'search') {
      setPendingSearch(b.query)
      onSearchOpen()
    } else if (b.kind === 'folder') {
      const sep = b.path.includes('\\') ? '\\' : '/'
      let current = workspace ?? ''
      for (const part of b.path.slice(current.length).split(/[\\/]/).filter(Boolean)) {
        current += sep + part
        expandFolder(current)
      }
      setSelectedFolder(b.path)
    } else {
      openTab(b.path)
      if (b.kind === 'heading') {
        setPendingHighlight(b.path, b.heading, true)
        window.dispatchEvent(new Event('search:jump'))
      }
    }
  }

  async function chooseGroup(index: number, current: string | undefined) {
    const name = await promptText('Group name:', current ?? '')
    if (name !== null) setGroup(index, name.trim() || undefined)
  }

  function dropOn(e: React.DragEvent, before: number, group: string | undefined) {
    e.preventDefault()
    const from = Number(e.dataTransfer.getData(DRAG_TYPE))
    if (e.dataTransfer.types.includes(DRAG_TYPE) && Number.isInteger(from)) move(from, before, group)
  }

  const allowDrop = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()

  return (
    <section className={`sidebar-bookmarks${collapsed ? ' is-collapsed' : ''}`}>
      <button className="sidebar-section-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
        <ChevronRight size={12} />
        <span>Bookmarks</span>
      </button>
      {!collapsed &&
        sectionBookmarks(items).map((section) => (
          <div key={section.group ?? ''} className="bookmark-section">
            {section.group && (
              <p
                className="bookmark-group"
                onDragOver={allowDrop}
                onDrop={(e) => dropOn(e, (section.entries.at(-1)?.index ?? 0) + 1, section.group ?? undefined)}
              >
                {section.group}
              </p>
            )}
            <ul className="bookmark-list">
              {section.entries.map(({ bookmark: b, index }) => {
                const Icon = ICONS[b.kind]
                const missing = isMissing(b)
                const label = bookmarkLabel(b, (path) => noteTitle(notes, path))
                return (
                  <li key={index}>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <div
                          className={`tree-row bookmark-row${missing ? ' is-missing' : ''}`}
                          draggable
                          role="button"
                          tabIndex={0}
                          title={missing ? `${label} (missing)` : label}
                          onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, String(index))}
                          onDragOver={allowDrop}
                          onDrop={(e) => dropOn(e, index, b.group)}
                          onClick={() => !missing && open(b)}
                          onKeyDown={(e) => e.key === 'Enter' && !missing && open(b)}
                        >
                          <Icon size={13} />
                          <span className="tree-label">{label}</span>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="context-menu">
                        <ContextMenuItem onSelect={() => void chooseGroup(index, b.group)}>
                          Set group…
                        </ContextMenuItem>
                        <ContextMenuItem variant="destructive" onSelect={() => remove(index)}>
                          Remove bookmark
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
    </section>
  )
}
