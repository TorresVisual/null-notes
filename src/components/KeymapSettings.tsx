import { useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { COMMANDS, bindingError, comboFromEvent, effectiveKeymap, formatCombo, type KeymapOverrides } from '../lib/keymap'

interface KeymapSettingsProps {
  overrides: KeymapOverrides
  onChange: (overrides: KeymapOverrides) => void
}

export function KeymapSettings({ overrides, onChange }: KeymapSettingsProps) {
  const [query, setQuery] = useState('')
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [rejected, setRejected] = useState<{ id: string; reason: string } | null>(null)
  const bindings = effectiveKeymap(overrides)

  function bind(id: string, combo: string) {
    const defaultKey = COMMANDS.find((c) => c.id === id)?.defaultKey ?? ''
    const next = { ...overrides, [id]: combo }
    if (combo === defaultKey) delete next[id]
    onChange(next)
  }

  function record(e: React.KeyboardEvent, id: string) {
    const combo = comboFromEvent(e.nativeEvent)
    if (!combo) return
    e.preventDefault()
    e.stopPropagation()
    const reason = bindingError(bindings, id, combo)
    setRecordingId(null)
    setRejected(reason ? { id, reason } : null)
    if (!reason) bind(id, combo)
  }

  const needle = query.trim().toLowerCase()
  const visible = COMMANDS.filter(
    (c) => !needle || c.label.toLowerCase().includes(needle) || formatCombo(bindings[c.id]).toLowerCase().includes(needle),
  )

  return (
    <div className="settings-section">
      <input
        type="search"
        className="keymap-search"
        placeholder="Search commands or keys…"
        aria-label="Search shortcuts"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="keymap-list settings-card">
        {visible.map((c) => {
          const combo = bindings[c.id]
          const recording = recordingId === c.id
          const changed = c.id in overrides
          return (
            <li key={c.id} className="keymap-row">
              <span className="keymap-label">
                {c.label}
                {rejected?.id === c.id && <small className="settings-error">{rejected.reason}</small>}
              </span>
              <span className="settings-row-control">
                <button
                  className={`keymap-binding${recording ? ' is-recording' : ''}`}
                  aria-label={`Change shortcut for ${c.label}`}
                  onClick={() => {
                    setRejected(null)
                    setRecordingId(c.id)
                  }}
                  onBlur={() => setRecordingId((cur) => (cur === c.id ? null : cur))}
                  onKeyDown={recording ? (e) => record(e, c.id) : undefined}
                >
                  {recording ? 'Press keys…' : combo ? formatCombo(combo) : 'Unbound'}
                </button>
                <button
                  className="keymap-icon"
                  aria-label={`Clear shortcut for ${c.label}`}
                  title="Clear"
                  disabled={!combo}
                  onClick={() => {
                    setRejected(null)
                    bind(c.id, '')
                  }}
                >
                  <X size={12} />
                </button>
                <button
                  className="keymap-icon"
                  aria-label={`Reset shortcut for ${c.label}`}
                  title="Reset to default"
                  disabled={!changed}
                  onClick={() => {
                    setRejected(null)
                    bind(c.id, c.defaultKey ?? '')
                  }}
                >
                  <RotateCcw size={12} />
                </button>
              </span>
            </li>
          )
        })}
        {!visible.length && <li className="keymap-empty">No matching command</li>}
      </ul>
      <button className="settings-reset" disabled={!Object.keys(overrides).length} onClick={() => onChange({})}>
        Reset all shortcuts
      </button>
    </div>
  )
}
