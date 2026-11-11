import { MobileNotesHeader } from './MobileNotesHeader'
import { NoteList } from './NoteList'
import { TagList } from './TagList'

interface MobileNotesProps {
  onTemplateOpen: () => void
}

export function MobileNotes({ onTemplateOpen }: MobileNotesProps) {
  return (
    <div className="mobile-notes sidebar-panel">
      <MobileNotesHeader onTemplateOpen={onTemplateOpen} />
      <NoteList />
      <TagList />
    </div>
  )
}
