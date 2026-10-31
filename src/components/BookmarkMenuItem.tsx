import { Bookmark as BookmarkIcon, BookmarkMinus } from 'lucide-react'
import { sameBookmark, type Bookmark } from '../lib/bookmarks'
import { useBookmarksStore } from '../store/bookmarks'
import { ContextMenuItem } from './ui/context-menu'

interface BookmarkMenuItemProps {
  bookmark: Bookmark
  label?: string
}

export function BookmarkMenuItem({ bookmark, label = 'Bookmark' }: BookmarkMenuItemProps) {
  const saved = useBookmarksStore((s) => s.items.some((b) => sameBookmark(b, bookmark)))
  const toggle = useBookmarksStore((s) => s.toggle)
  return (
    <ContextMenuItem onSelect={() => toggle(bookmark)}>
      {saved ? <BookmarkMinus size={14} /> : <BookmarkIcon size={14} />}
      {saved ? `Remove ${label.toLowerCase()}` : label}
    </ContextMenuItem>
  )
}
