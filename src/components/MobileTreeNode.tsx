import { Bookmark as BookmarkIcon, BookmarkMinus, ChevronRight, Ellipsis, FileText, Folder, Pencil, Trash2 } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useBookmarksStore } from '../store/bookmarks'
import { useActionSheetStore, type SheetAction } from '../store/actionSheet'
import { useLongPress } from '../hooks/useLongPress'
import { sameBookmark } from '../lib/bookmarks'
import { deleteFolder, deleteNote, renameCanvas, renameFolder, renameNote } from '../lib/noteActions'
import { isUnderPath } from '../lib/pathPrefix'
import type { TreeEntry } from '../lib/folderTree'

const INDENT_PX = 32

function rowActions(entry: TreeEntry): SheetAction[] {
  const rename = entry.type === 'folder' ? () => void renameFolder(entry.path, entry.name) : entry.type === 'canvas' ? () => void renameCanvas(entry.path) : () => void renameNote(entry.path)
  const remove = entry.type === 'folder' ? () => void deleteFolder(entry.path, entry.name) : () => void deleteNote(entry.path)
  const actions: SheetAction[] = [{ label: 'Rename', icon: Pencil, onSelect: rename }]
  if (entry.type !== 'canvas') {
    const bookmark = { kind: entry.type, path: entry.path } as const
    const saved = useBookmarksStore.getState().items.some((b) => sameBookmark(b, bookmark))
    actions.push({
      label: saved ? 'Remove bookmark' : 'Bookmark',
      icon: saved ? BookmarkMinus : BookmarkIcon,
      onSelect: () => useBookmarksStore.getState().toggle(bookmark),
    })
  }
  actions.push({ label: 'Delete', icon: Trash2, onSelect: remove, destructive: true })
  return actions
}

interface MobileTreeNodeProps {
  entry: TreeEntry
  depth?: number
}

export function MobileTreeNode({ entry, depth = 0 }: MobileTreeNodeProps) {
  const expanded = useWorkspaceStore((s) => s.expandedFolders.includes(entry.path))
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder)
  const setSelectedFolder = useWorkspaceStore((s) => s.setSelectedFolder)
  const setTagFilter = useWorkspaceStore((s) => s.setTagFilter)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const noteCount = useNotesStore((s) => (entry.type === 'folder' ? s.notes.filter((n) => isUnderPath(n.path, entry.path)).length : 0))
  const openSheet = useActionSheetStore((s) => s.open)

  const showActions = () => openSheet({ title: entry.name, actions: rowActions(entry) })
  const longPress = useLongPress(showActions)
  const isFolder = entry.type === 'folder'

  function activate() {
    if (!isFolder) {
      openTab(entry.path)
      return
    }
    toggleFolder(entry.path)
    setSelectedFolder(entry.path)
    setTagFilter(null)
  }

  return (
    <li>
      <div className="mobile-tree-row" style={{ paddingLeft: `calc(var(--space-lg) + ${depth * INDENT_PX}px)` }} {...longPress}>
        <button className="mobile-tree-main" aria-expanded={isFolder ? expanded : undefined} onClick={activate}>
          {isFolder ? (
            <ChevronRight size={16} className={`mobile-tree-chevron${expanded ? ' open' : ''}`} />
          ) : (
            <span className="mobile-tree-chevron" />
          )}
          <span className={`mobile-tree-icon${isFolder ? ' is-folder' : ''}`}>
            {isFolder ? <Folder size={16} /> : <FileText size={16} />}
          </span>
          <span className="mobile-home-body">
            <span className={`mobile-home-title${isFolder ? ' is-folder' : ''}`}>{entry.name}</span>
            {isFolder && <span className="mobile-home-sub">{noteCount} {noteCount === 1 ? 'note' : 'notes'}</span>}
          </span>
        </button>
        <button className="mobile-icon-btn" aria-label={`Actions for ${entry.name}`} onClick={showActions}>
          <Ellipsis size={20} />
        </button>
      </div>
      {isFolder && expanded && (
        <ul className="mobile-tree-children">
          {entry.children.map((child) => (
            <MobileTreeNode key={child.path} entry={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}
