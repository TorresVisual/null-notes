import { Check, Pencil } from 'lucide-react'

interface MobileEditToggleProps {
  readOnly: boolean
  onEdit: () => void
  onDone: () => void
}

export function MobileEditToggle({ readOnly, onEdit, onDone }: MobileEditToggleProps) {
  return (
    <button
      type="button"
      className={readOnly ? 'mobile-edit-toggle' : 'mobile-edit-toggle is-editing'}
      aria-label={readOnly ? 'Edit note' : 'Done'}
      onClick={readOnly ? onEdit : onDone}
    >
      {readOnly ? <Pencil size={20} /> : <Check size={20} />}
    </button>
  )
}
