import { SidebarHeader } from './SidebarHeader'
import { NoteList } from './NoteList'
import { TagList } from './TagList'

interface MobileNotesProps {
  onSearchOpen: () => void
  onTemplateOpen: () => void
}

export function MobileNotes({ onSearchOpen, onTemplateOpen }: MobileNotesProps) {
  return (
    <div className="mobile-notes sidebar-panel">
      <SidebarHeader onSearchOpen={onSearchOpen} onTemplateOpen={onTemplateOpen} afterAction={() => undefined} />
      <NoteList />
      <TagList />
    </div>
  )
}
