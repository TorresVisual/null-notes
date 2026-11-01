import { useRef } from 'react'
import { Plus } from 'lucide-react'
import { plainPropertyKey } from '../../lib/baseColumns'
import { toStr } from '../../lib/baseValue'
import type { BaseValue } from '../../lib/baseValue'
import { kanbanMove, toPropertyValue } from '../../lib/kanbanMove'
import type { LayoutProps } from './layoutProps'

interface Drag {
  path: string
  from: BaseValue
}

export function KanbanView({ result, view, onWrite, onCreate, onOpen }: LayoutProps) {
  const dragging = useRef<Drag | null>(null)
  const groupBy = view.groupBy as { property?: string } | undefined
  const property = groupBy?.property
  const key = property ? plainPropertyKey(property) : null
  const meta = result.columns.filter((c) => c.id !== 'file.name' && c.id !== property)

  if (!property) return <p className="base-empty">Choose a “Group by” property to lay out the board.</p>
  if (!key) return <p className="base-empty">A board can only group by a plain note property.</p>

  const drop = (to: BaseValue) => {
    const drag = dragging.current
    dragging.current = null
    if (!drag) return
    const row = result.groups.flatMap((g) => g.rows).find((r) => r.path === drag.path)
    if (!row || drag.from === to) return
    onWrite(row, key, kanbanMove(row.properties[key], drag.from, to))
  }

  return (
    <div className="base-kanban">
      {result.groups.map((group) => (
        <section
          key={group.label}
          role="group"
          aria-label={group.label}
          className="base-kanban-column"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drop(group.key)}
        >
          <h3 className="base-group-title">
            {group.label} <span className="base-count">{group.rows.length}</span>
          </h3>
          {group.rows.map((row) => (
            <div
              key={row.path}
              className="base-card"
              draggable
              onDragStart={(e) => {
                dragging.current = { path: row.path, from: group.key }
                e.dataTransfer?.setData('text/plain', row.path)
              }}
            >
              <button className="base-link" onClick={() => onOpen(row.path)}>{row.title}</button>
              {meta.map((c) => {
                const text = toStr(result.cell(row, c.id))
                return text ? <span className="base-card-meta" key={c.id}>{text}</span> : null
              })}
            </div>
          ))}
          <button className="base-add-card" onClick={() => onCreate(group.key === null ? {} : { [key]: toPropertyValue(group.key) })}>
            <Plus size={12} /> Add card
          </button>
        </section>
      ))}
    </div>
  )
}
