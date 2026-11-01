import { Pencil, Trash2 } from 'lucide-react'
import type { BaseView } from '../../lib/baseFile'

export const VIEW_TYPES = ['table', 'list', 'cards', 'kanban', 'map'] as const

interface BaseViewTabsProps {
  views: BaseView[]
  active: number
  onSelect: (index: number) => void
  onAdd: (type: string) => void
  onRename: (index: number) => void
  onDelete: (index: number) => void
}

export function BaseViewTabs({ views, active, onSelect, onAdd, onRename, onDelete }: BaseViewTabsProps) {
  return (
    <div className="base-tabs" role="tablist">
      {views.map((view, index) => (
        <button
          key={index}
          role="tab"
          aria-selected={index === active}
          className={`base-tab${index === active ? ' active' : ''}`}
          onClick={() => onSelect(index)}
        >
          {view.name || view.type}
        </button>
      ))}
      <select
        className="base-select"
        aria-label="Add view"
        value=""
        onChange={(e) => e.target.value && onAdd(e.target.value)}
      >
        <option value="">+ View</option>
        {VIEW_TYPES.map((type) => (
          <option key={type} value={type}>{type}</option>
        ))}
      </select>
      {views[active] && (
        <>
          <button className="base-icon-button" aria-label="Rename view" onClick={() => onRename(active)}>
            <Pencil size={12} />
          </button>
          <button
            className="base-icon-button"
            aria-label="Delete view"
            disabled={views.length < 2}
            onClick={() => onDelete(active)}
          >
            <Trash2 size={12} />
          </button>
        </>
      )}
    </div>
  )
}
