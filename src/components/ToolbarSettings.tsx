import { ArrowDown, ArrowUp, EyeOff, Plus } from 'lucide-react'
import { hiddenToolbarItems, resolveToolbarItems } from '../editor/toolbar/toolbarItems'

interface ToolbarSettingsProps {
  saved: string[] | null
  onChange: (ids: string[] | null) => void
}

export function ToolbarSettings({ saved, onChange }: ToolbarSettingsProps) {
  const shown = resolveToolbarItems(saved)
  const ids = shown.map((item) => item.id)
  const hidden = hiddenToolbarItems(saved)

  function move(from: number, to: number) {
    const next = [...ids]
    next.splice(to, 0, ...next.splice(from, 1))
    onChange(next)
  }

  return (
    <div className="toolbar-settings">
      <div className="toolbar-settings-head">
        <span>
          Editing toolbar
          <small>The buttons above the keyboard. Reorder, hide or add them back.</small>
        </span>
        <button className="settings-reset" disabled={saved === null} onClick={() => onChange(null)}>
          Reset
        </button>
      </div>
      <ul className="toolbar-settings-list" aria-label="Shown toolbar items">
        {shown.map((item, i) => (
          <li key={item.id} className="toolbar-settings-row">
            <item.icon size={18} />
            <span>{item.label}</span>
            <button aria-label={`Move ${item.label} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
              <ArrowUp size={18} />
            </button>
            <button aria-label={`Move ${item.label} down`} disabled={i === shown.length - 1} onClick={() => move(i, i + 1)}>
              <ArrowDown size={18} />
            </button>
            <button aria-label={`Hide ${item.label}`} onClick={() => onChange(ids.filter((id) => id !== item.id))}>
              <EyeOff size={18} />
            </button>
          </li>
        ))}
      </ul>
      {hidden.length > 0 && (
        <>
          <p className="toolbar-settings-subhead">Hidden</p>
          <ul className="toolbar-settings-list" aria-label="Hidden toolbar items">
            {hidden.map((item) => (
              <li key={item.id} className="toolbar-settings-row">
                <item.icon size={18} />
                <span>{item.label}</span>
                <button aria-label={`Add ${item.label}`} onClick={() => onChange([...ids, item.id])}>
                  <Plus size={18} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
