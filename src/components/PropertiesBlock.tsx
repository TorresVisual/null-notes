import { useState } from 'react'
import { ChevronRight, Plus, X } from 'lucide-react'
import { api } from '../lib/tauri'
import { inferType } from '../lib/propertyType'
import { useProperties } from '../hooks/useProperties'
import type { PropertyEdit } from '../types'
import { PropertyValueInput } from './PropertyValueInput'

interface PropertiesBlockProps {
  content: string
  onSave: (content: string) => void
}

export function PropertiesBlock({ content, onSave }: PropertiesBlockProps) {
  const { properties, error } = useProperties(content)
  const [open, setOpen] = useState<boolean | null>(null)
  const [adding, setAdding] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const entries = Object.entries(properties)
  const expanded = open ?? entries.length > 0

  const apply = async (edit: PropertyEdit) => {
    try {
      setEditError(null)
      onSave(await api.properties.edit(content, edit))
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e))
    }
  }

  const addProperty = (key: string) => {
    setAdding(false)
    if (!key) return
    if (key in properties) return setEditError(`"${key}" already exists`)
    void apply({ type: 'set', key, value: '' })
  }

  if (error) {
    return (
      <div className="properties-block">
        <p className="properties-error" role="alert">
          Properties can’t be read: {error}
        </p>
      </div>
    )
  }

  return (
    <div className="properties-block">
      {entries.length > 0 && (
        <button className="properties-toggle" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
          <ChevronRight size={12} className={`properties-chevron${expanded ? ' open' : ''}`} />
          Properties ({entries.length})
        </button>
      )}
      {expanded &&
        entries.map(([key, value]) => (
          <div className="properties-row" key={`${key}:${JSON.stringify(value)}`}>
            <input
              className="properties-key"
              aria-label={`Rename ${key}`}
              defaultValue={key}
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (next && next !== key) void apply({ type: 'rename', from: key, to: next })
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <PropertyValueInput
              name={key}
              type={inferType(value)}
              value={value}
              onCommit={(next) => void apply({ type: 'set', key, value: next })}
            />
            <button className="properties-remove" aria-label={`Remove ${key}`} onClick={() => void apply({ type: 'remove', key })}>
              <X size={12} />
            </button>
          </div>
        ))}
      {adding ? (
        <input
          className="properties-key"
          aria-label="New property name"
          autoFocus
          onBlur={(e) => addProperty(e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setAdding(false)
          }}
        />
      ) : (
        <button className="properties-add" onClick={() => { setOpen(true); setAdding(true) }}>
          <Plus size={12} /> Add property
        </button>
      )}
      {editError && <p className="properties-error" role="alert">{editError}</p>}
    </div>
  )
}
