import { ArrowDownAZ, ArrowUpAZ, Code, Plus } from 'lucide-react'
import { addView, removeView, renameView, updateView } from '../../lib/baseFile'
import type { BaseDoc, BaseFile } from '../../lib/baseFile'
import { availableColumns } from '../../lib/baseColumns'
import type { ViewResult } from '../../lib/baseQuery'
import { promptText } from '../../store/promptDialog'
import type { BaseRow } from '../../types'
import { BaseColumnsMenu } from './BaseColumnsMenu'
import { BaseViewTabs } from './BaseViewTabs'

interface BaseToolbarProps {
  base: BaseFile
  rows: BaseRow[]
  result: ViewResult | null
  viewIndex: number
  saveLabel: string
  sourceOpen: boolean
  onSelectView: (index: number) => void
  onEdit: (change: (doc: BaseDoc) => void) => void
  onToggleSource: () => void
  onCreate: () => void
}

interface SortEntry {
  property?: string
  direction?: string
}

export function BaseToolbar({
  base, rows, result, viewIndex, saveLabel, sourceOpen, onSelectView, onEdit, onToggleSource, onCreate,
}: BaseToolbarProps) {
  const view = base.views[viewIndex]
  const ids = availableColumns(base, rows)
  const sort = (Array.isArray(view?.sort) ? view.sort[0] : undefined) as SortEntry | undefined
  const groupBy = view?.groupBy as { property?: string } | undefined
  const labelOf = (id: string) => result?.columns.find((c) => c.id === id)?.label ?? id.replace(/^(note|formula)\./, '')

  const setView = (patch: Parameters<typeof updateView>[2]) => onEdit((doc) => updateView(doc, viewIndex, patch))

  const addNew = (type: string) => {
    const name = type.charAt(0).toUpperCase() + type.slice(1)
    onEdit((doc) => addView(doc, { type, name }))
    onSelectView(base.views.length)
  }

  const rename = async (index: number) => {
    const name = await promptText('View name:', base.views[index]?.name ?? '')
    if (name) onEdit((doc) => renameView(doc, index, name))
  }

  const remove = (index: number) => {
    onEdit((doc) => removeView(doc, index))
    onSelectView(Math.max(0, index - 1))
  }

  return (
    <div className="base-toolbar">
      <BaseViewTabs
        views={base.views}
        active={viewIndex}
        onSelect={onSelectView}
        onAdd={addNew}
        onRename={(i) => void rename(i)}
        onDelete={remove}
      />
      {view && (
        <div className="base-controls">
          <BaseColumnsMenu
            available={ids}
            selected={result?.columns.map((c) => c.id) ?? []}
            labelOf={labelOf}
            onChange={(order) => setView({ order })}
          />
          <select
            className="base-select"
            aria-label="Sort by"
            value={sort?.property ?? ''}
            onChange={(e) =>
              setView({ sort: e.target.value ? [{ property: e.target.value, direction: sort?.direction ?? 'ASC' }] : undefined })
            }
          >
            <option value="">Sort: none</option>
            {ids.map((id) => <option key={id} value={id}>{labelOf(id)}</option>)}
          </select>
          {sort?.property && (
            <button
              className="base-icon-button"
              aria-label={sort.direction === 'DESC' ? 'Sort descending' : 'Sort ascending'}
              onClick={() => setView({ sort: [{ property: sort.property, direction: sort.direction === 'DESC' ? 'ASC' : 'DESC' }] })}
            >
              {sort.direction === 'DESC' ? <ArrowDownAZ size={12} /> : <ArrowUpAZ size={12} />}
            </button>
          )}
          <select
            className="base-select"
            aria-label="Group by"
            value={groupBy?.property ?? ''}
            onChange={(e) => setView({ groupBy: e.target.value ? { property: e.target.value, direction: 'ASC' } : undefined })}
          >
            <option value="">Group: none</option>
            {ids.map((id) => <option key={id} value={id}>{labelOf(id)}</option>)}
          </select>
          {view.type === 'map' && (
            <select
              className="base-select"
              aria-label="Coordinates"
              value={typeof view.coordinates === 'string' ? view.coordinates : ''}
              onChange={(e) => setView({ coordinates: e.target.value || undefined })}
            >
              <option value="">Coordinates: none</option>
              {ids.map((id) => <option key={id} value={id}>{labelOf(id)}</option>)}
            </select>
          )}
        </div>
      )}
      <span className="base-save-state">{saveLabel}</span>
      <button className={`base-button${sourceOpen ? ' active' : ''}`} aria-pressed={sourceOpen} onClick={onToggleSource}>
        <Code size={12} /> Edit source
      </button>
      <button className="base-button" onClick={onCreate}>
        <Plus size={12} /> New
      </button>
    </div>
  )
}
