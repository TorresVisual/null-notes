import { useState } from 'react'
import { X } from 'lucide-react'
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settings'
import { useWorkspaceStore } from '../store/workspace'
import { useGitConfig } from '../hooks/useGitConfig'
import { api } from '../lib/tauri'

interface SettingsPanelProps {
  onClose: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const settings = useSettingsStore((s) => s.settings)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const repoMode = useWorkspaceStore((s) => s.repoMode)
  const gitAutoCommit = useWorkspaceStore((s) => s.git.autoCommit)
  const gitIdleMinutes = useWorkspaceStore((s) => s.git.idleMinutes)
  const gitSkipHooks = useWorkspaceStore((s) => s.git.skipHooks)
  const gitAutoPush = useWorkspaceStore((s) => s.git.autoPush)
  const { updateGit } = useGitConfig()
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

        {repoMode && (
          <label className="settings-row">
            <span>
              Auto-commit this workspace
              <small>
                {repoMode === 'notesOnly'
                  ? 'This workspace is its own Git repository.'
                  : 'This workspace sits inside a larger code repository — auto-commit only ever touches note paths, and never auto-pushes here.'}{' '}
                Machine-local, not synced with the notes.
              </small>
            </span>
            <span className="settings-row-control">
              <input
                type="checkbox"
                checked={gitAutoCommit}
                onChange={(e) => void updateGit({ prompted: true, autoCommit: e.target.checked })}
              />
            </span>
          </label>
        )}

        {repoMode && gitAutoCommit && (
          <>
            <label className="settings-row">
              <span>
                Auto-commit idle window
                <small>Minutes of no note activity before a pending batch is committed.</small>
              </span>
              <span className="settings-row-control">
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={gitIdleMinutes}
                  onChange={(e) => void updateGit({ idleMinutes: Number(e.target.value) })}
                />
                <span className="settings-unit">min</span>
              </span>
            </label>

            <label className="settings-row">
              <span>
                Skip commit hooks
                <small>
                  Run without <code>pre-commit</code>/<code>commit-msg</code> hooks. Off by default — a
                  failing hook aborts the auto-commit instead.
                </small>
              </span>
              <span className="settings-row-control">
                <input
                  type="checkbox"
                  checked={gitSkipHooks}
                  onChange={(e) => void updateGit({ skipHooks: e.target.checked })}
                />
              </span>
            </label>

            {repoMode === 'notesOnly' && (
              <label className="settings-row">
                <span>
                  Push after commit
                  <small>
                    Only ever applies to a notes-only repo — a workspace inside a code repo never
                    auto-pushes, at any setting.
                  </small>
                </span>
                <span className="settings-row-control">
                  <input
                    type="checkbox"
                    checked={gitAutoPush}
                    onChange={(e) => void updateGit({ autoPush: e.target.checked })}
                  />
                </span>
              </label>
            )}
          </>
        )}

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
