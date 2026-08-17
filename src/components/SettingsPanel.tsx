import { useState } from 'react'
import { X } from 'lucide-react'
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settings'
import { api } from '../lib/tauri'

interface SettingsPanelProps {
  onClose: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const settings = useSettingsStore((s) => s.settings)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const [error, setError] = useState<string | null>(null)

  async function update(patch: Partial<typeof settings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    try {
      await api.settings.save(next)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="settings-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>Settings</h2>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close settings">
            <X size={16} />
          </button>
        </div>

        <label className="settings-row">
          <span>
            Autosave delay
            <small>How long to wait after you stop typing before writing to disk.</small>
          </span>
          <span className="settings-row-control">
            <input
              type="number"
              min={100}
              max={5000}
              step={100}
              value={settings.autosaveDebounceMs}
              onChange={(e) => void update({ autosaveDebounceMs: Number(e.target.value) })}
            />
            <span className="settings-unit">ms</span>
          </span>
        </label>

        <label className="settings-row">
          <span>
            Editor width
            <small>Maximum width of the note column.</small>
          </span>
          <span className="settings-row-control">
            <input
              type="number"
              min={480}
              max={1600}
              step={20}
              value={settings.editorMaxWidthPx}
              onChange={(e) => void update({ editorMaxWidthPx: Number(e.target.value) })}
            />
            <span className="settings-unit">px</span>
          </span>
        </label>

        <label className="settings-row">
          <span>
            Spellcheck
            <small>Underline misspelled words in prose. Code, maths, diagrams, tags and link targets are never checked.</small>
          </span>
          <span className="settings-row-control">
            <input
              type="checkbox"
              checked={settings.spellcheck}
              onChange={(e) => void update({ spellcheck: e.target.checked })}
            />
          </span>
        </label>

        <label className="settings-row">
          <span>
            Spellcheck language
            <small>
              A BCP-47 tag (<code>de</code>, <code>en</code>, <code>en-GB</code>). Whether squiggles appear at
              all is the OS language pack's call, not this app's.
            </small>
          </span>
          <span className="settings-row-control">
            <input
              type="text"
              className="settings-text"
              value={settings.spellcheckLanguage}
              onChange={(e) => void update({ spellcheckLanguage: e.target.value.trim() })}
            />
          </span>
        </label>

        <label className="settings-row">
          <span>
            Editor command
            <small>
              Launched when you click a <code>src/main.rs:58</code> link. <code>{'{file}'}</code> and{' '}
              <code>{'{line}'}</code> are filled in; run without a shell. Detected on first load.
            </small>
          </span>
          <span className="settings-row-control">
            <input
              type="text"
              className="settings-text settings-text-wide"
              value={settings.editorCommand}
              onChange={(e) => void update({ editorCommand: e.target.value })}
            />
          </span>
        </label>

        <label className="settings-row">
          <span>
            Terminal shell
            <small>
              Spawned by the terminal pane (<code>Ctrl `</code>), rooted at the workspace. Detected on
              first load.
            </small>
          </span>
          <span className="settings-row-control">
            <input
              type="text"
              className="settings-text settings-text-wide"
              value={settings.terminalShell}
              onChange={(e) => void update({ terminalShell: e.target.value })}
            />
          </span>
        </label>

        {error && <p className="settings-error">{error}</p>}

        <button
          className="settings-reset"
          onClick={() => void update(DEFAULT_SETTINGS)}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  )
}
