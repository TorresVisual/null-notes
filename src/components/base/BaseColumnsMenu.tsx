import { ArrowDown, ArrowUp } from 'lucide-react'

interface BaseColumnsMenuProps {
  available: string[]
  selected: string[]
  labelOf: (id: string) => string
  onChange: (ids: string[]) => void
}

export function BaseColumnsMenu({ available, selected, labelOf, onChange }: BaseColumnsMenuProps) {
  const move = (index: number, by: -1 | 1) => {
    const next = [...selected]
    const [item] = next.splice(index, 1)
    if (item !== undefined) next.splice(index + by, 0, item)
    onChange(next)
  }
  const unselected = available.filter((id) => !selected.includes(id))

  return (
    <details className="base-menu">
      <summary>Columns</summary>
      <div className="base-menu-panel">
        {selected.map((id, index) => (
          <div className="base-menu-row" key={id}>
            <label>
              <input type="checkbox" checked onChange={() => onChange(selected.filter((s) => s !== id))} />
              {labelOf(id)}
            </label>
            <button className="base-icon-button" aria-label={`Move ${labelOf(id)} up`} disabled={index === 0} onClick={() => move(index, -1)}>
              <ArrowUp size={12} />
            </button>
            <button className="base-icon-button" aria-label={`Move ${labelOf(id)} down`} disabled={index === selected.length - 1} onClick={() => move(index, 1)}>
              <ArrowDown size={12} />
            </button>
          </div>
        ))}
        {unselected.map((id) => (
          <div className="base-menu-row" key={id}>
            <label>
              <input type="checkbox" checked={false} onChange={() => onChange([...selected, id])} />
              {labelOf(id)}
            </label>
          </div>
        ))}
      </div>
    </details>
  )
}
