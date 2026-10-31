import { useState } from 'react'
import type { PropertyType } from '../lib/propertyType'

interface PropertyValueInputProps {
  name: string
  type: PropertyType
  value: unknown
  onCommit: (value: unknown) => void
}

function toText(type: PropertyType, value: unknown): string {
  if (type === 'list' && Array.isArray(value)) return value.map(String).join(', ')
  return value === null || value === undefined ? '' : String(value)
}

export function PropertyValueInput({ name, type, value, onCommit }: PropertyValueInputProps) {
  const initial = toText(type, value)
  const [draft, setDraft] = useState(initial)

  if (type === 'checkbox') {
    return (
      <input
        type="checkbox"
        aria-label={name}
        checked={value === true}
        onChange={(e) => onCommit(e.target.checked)}
      />
    )
  }

  const commit = () => {
    if (draft === initial) return
    if (type === 'number') {
      const parsed = Number(draft)
      if (draft.trim() === '' || Number.isNaN(parsed)) return setDraft(initial)
      return onCommit(parsed)
    }
    if (type === 'list') {
      return onCommit(draft.split(',').map((item) => item.trim()).filter(Boolean))
    }
    onCommit(draft)
  }

  const inputType = { number: 'number', date: 'date', datetime: 'datetime-local', text: 'text', list: 'text' }[type]

  return (
    <input
      type={inputType}
      aria-label={name}
      className="properties-value"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}
