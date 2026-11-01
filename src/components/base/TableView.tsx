import type { LayoutProps } from './layoutProps'
import { PropertyCell } from './PropertyCell'

export function TableView({ result, view, onWrite, onOpen }: LayoutProps) {
  const { columns, groups, cell } = result
  const grouped = Boolean(view.groupBy)
  const total = groups.reduce((n, g) => n + g.rows.length, 0)
  if (total === 0 && !grouped) return <p className="base-empty">No notes match this view.</p>

  return (
    <div className="base-table-wrap">
      <table className="base-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col">{column.label}</th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.label}>
            {grouped && (
              <tr className="base-group-row">
                <th colSpan={columns.length} scope="rowgroup">
                  <h3 className="base-group-title">{group.label}</h3>
                </th>
              </tr>
            )}
            {group.rows.map((row) => (
              <tr key={row.path}>
                {columns.map((column) => (
                  <td key={column.id}>
                    {column.id === 'file.name' ? (
                      <button className="base-link" onClick={() => onOpen(row.path)}>{row.title}</button>
                    ) : (
                      <PropertyCell row={row} columnId={column.id} value={cell(row, column.id)} onWrite={onWrite} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}
