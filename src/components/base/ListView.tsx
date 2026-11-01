import { toStr } from '../../lib/baseValue'
import type { LayoutProps } from './layoutProps'

export function ListView({ result, view, onOpen }: LayoutProps) {
  const { columns, groups, cell } = result
  const extra = columns.filter((c) => c.id !== 'file.name')
  const grouped = Boolean(view.groupBy)
  if (groups.every((g) => g.rows.length === 0) && !grouped) {
    return <p className="base-empty">No notes match this view.</p>
  }

  return (
    <div className="base-list-wrap">
      {groups.map((group) => (
        <section key={group.label}>
          {grouped && <h3 className="base-group-title">{group.label}</h3>}
          <ul className="base-list">
            {group.rows.map((row) => {
              const meta = extra.map((c) => toStr(cell(row, c.id))).filter(Boolean)
              return (
                <li key={row.path}>
                  <button className="base-link" onClick={() => onOpen(row.path)}>{row.title}</button>
                  {meta.length > 0 && <span className="base-list-meta">{meta.join(', ')}</span>}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
