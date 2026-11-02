import { useState } from 'react'
import { GitBranch, Info, Keyboard, SpellCheck, SquarePen, Wrench, X, type LucideIcon } from 'lucide-react'
import { confirm, message } from '@tauri-apps/plugin-dialog'
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settings'
import { useWorkspaceStore } from '../store/workspace'
import { useGitConfig } from '../hooks/useGitConfig'
import { api } from '../lib/tauri'
import { failure } from '../lib/failure'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { AboutSettings } from './AboutSettings'
import { ErrorLogDialog } from './ErrorLogDialog'
import { KeymapSettings } from './KeymapSettings'

interface SettingsPanelProps {
  onClose: () => void
}

type SectionId = 'editor' | 'writing' | 'tools' | 'shortcuts' | 'git' | 'about'

const SECTIONS: { id: SectionId; label: string; Icon: LucideIcon }[] = [
  { id: 'editor', label: 'Editor', Icon: SquarePen },
  { id: 'writing', label: 'Writing', Icon: SpellCheck },
  { id: 'tools', label: 'Tools', Icon: Wrench },
  { id: 'shortcuts', label: 'Shortcuts', Icon: Keyboard },
  { id: 'git', label: 'Git', Icon: GitBranch },
  { id: 'about', label: 'About', Icon: Info },
]

function clampNumber(raw: number, min: number, max: number): number {
  if (Number.isNaN(raw)) return min
  return Math.min(max, Math.max(min, raw))
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const settings = useSettingsStore((s) => s.settings)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const repoMode = useWorkspaceStore((s) => s.repoMode)
  const gitAutoCommit = useWorkspaceStore((s) => s.git.autoCommit)
  const gitIdleMinutes = useWorkspaceStore((s) => s.git.idleMinutes)
  const gitSkipHooks = useWorkspaceStore((s) => s.git.skipHooks)
  const gitAutoPush = useWorkspaceStore((s) => s.git.autoPush)
  const gitAllowCodeRepoPush = useWorkspaceStore((s) => s.git.allowCodeRepoPush)
  const { updateGit } = useGitConfig()
  const [error, setError] = useState<string | null>(null)
  const [showErrorLog, setShowErrorLog] = useState(false)
  const [section, setSection] = useState<SectionId>('editor')
  const hasGit = Boolean(workspacePath && repoMode === null) || Boolean(repoMode)
  const sections = SECTIONS.filter((s) => s.id !== 'git' || hasGit)
  const currentId: SectionId = sections.some((s) => s.id === section) ? section : 'editor'

  async function update(patch: Partial<typeof settings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    try {
      await api.settings.save(next)
      setError(null)
    } catch (e) {
      setError(failure('save settings', e))
    }
  }

  return (
    <>
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="settings-panel settings-panel--lg" showCloseButton={false}>
        <nav className="settings-nav" aria-label="Settings sections">
          <DialogTitle asChild>
            <h2>Settings</h2>
          </DialogTitle>
          {sections.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`settings-nav-item${id === currentId ? ' is-active' : ''}`}
              aria-current={id === currentId ? 'page' : undefined}
              onClick={() => setSection(id)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
          <button
            className="settings-reset settings-nav-reset"
            onClick={() => {
              void (async () => {
                const proceed = await confirm('Reset every setting on this page to its default value?')
                if (proceed) await update(DEFAULT_SETTINGS)
              })()
            }}
          >
            Reset to defaults
          </button>
        </nav>

        <div className="settings-content">
        <div className="settings-panel-header">
          <h3>{sections.find((s) => s.id === currentId)?.label}</h3>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close settings" title="Close settings">
            <X size={16} />
          </button>
        </div>

        <div className="settings-panel-body">
          {currentId === 'editor' && (
          <>
          <div className="settings-card">
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
                  onChange={(e) =>
                    void update({ autosaveDebounceMs: clampNumber(Number(e.target.value), 100, 5000) })
                  }
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
                  onChange={(e) =>
                    void update({ editorMaxWidthPx: clampNumber(Number(e.target.value), 480, 1600) })
                  }
                />
                <span className="settings-unit">px</span>
              </span>
            </label>

          </div>

          <h4 className="settings-group-title">Code blocks</h4>
          <div className="settings-card">
            <label className="settings-row">
              <span>
                Code block indent
                <small>What a Tab keypress inserts in a code block.</small>
              </span>
              <span className="settings-row-control">
                <select
                  value={settings.codeIndentChar}
                  onChange={(e) => void update({ codeIndentChar: e.target.value as 'space' | 'tab' })}
                >
                  <option value="space">Spaces</option>
                  <option value="tab">Tab</option>
                </select>
                {settings.codeIndentChar === 'space' && (
                  <input
                    type="number"
                    min={1}
                    max={8}
                    step={1}
                    value={settings.codeIndentWidth}
                    onChange={(e) =>
                      void update({ codeIndentWidth: clampNumber(Number(e.target.value), 1, 8) })
                    }
                  />
                )}
              </span>
            </label>

            <label className="settings-row">
              <span>
                Code block theme
                <small>Syntax-highlight color palette.</small>
              </span>
              <span className="settings-row-control">
                <select
                  value={settings.codeTheme}
                  onChange={(e) => void update({ codeTheme: e.target.value as 'material-ocean' | 'one-dark' })}
                >
                  <option value="material-ocean">Material Ocean</option>
                  <option value="one-dark">One Dark</option>
                </select>
              </span>
            </label>

            <label className="settings-row">
              <span>
                Code block font size
                <small>Independent of the editor&apos;s own text size above.</small>
              </span>
              <span className="settings-row-control">
                <input
                  type="number"
                  min={10}
                  max={24}
                  step={1}
                  value={settings.codeFontSizePx}
                  onChange={(e) =>
                    void update({ codeFontSizePx: clampNumber(Number(e.target.value), 10, 24) })
                  }
                />
                <span className="settings-unit">px</span>
              </span>
            </label>
          </div>
          </>
          )}

          {currentId === 'writing' && (
          <div className="settings-card">
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
                  all is the OS language pack&apos;s call, not this app&apos;s.
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
          </div>
          )}

          {currentId === 'tools' && (
          <>
          <div className="settings-card">
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

            <label className="settings-row">
              <span>
                Map tile URL
                <small>
                  Raster tiles for the map layout of a base, with <code>{'{z}'}</code>, <code>{'{x}'}</code> and{' '}
                  <code>{'{y}'}</code>. The default is the public OpenStreetMap server; offline, pins show on a blank map.
                </small>
              </span>
              <span className="settings-row-control">
                <input
                  type="text"
                  className="settings-text settings-text-wide"
                  value={settings.mapTileUrl}
                  onChange={(e) => void update({ mapTileUrl: e.target.value.trim() })}
                />
              </span>
            </label>

            <label className="settings-row">
              <span>
                Python command
                <small>
                  Runs a <code>python</code> code block&apos;s Run button. No shell, no sandbox — same trust
                  level as typing it into the terminal. Detected on first load.
                </small>
              </span>
              <span className="settings-row-control">
                <input
                  type="text"
                  className="settings-text settings-text-wide"
                  value={settings.pythonCommand}
                  onChange={(e) => void update({ pythonCommand: e.target.value })}
                />
              </span>
            </label>

            <label className="settings-row">
              <span>
                C++ compiler command
                <small>
                  Compiles a <code>cpp</code> code block before running it. MSVC (<code>cl.exe</code>) isn&apos;t
                  detected. Detected on first load.
                </small>
              </span>
              <span className="settings-row-control">
                <input
                  type="text"
                  className="settings-text settings-text-wide"
                  value={settings.cppCompilerCommand}
                  onChange={(e) => void update({ cppCompilerCommand: e.target.value })}
                />
              </span>
            </label>

            <label className="settings-row">
              <span>
                Run timeout (seconds)
                <small>A running code block is killed automatically after this many seconds.</small>
              </span>
              <span className="settings-row-control">
                <input
                  type="number"
                  min={1}
                  className="settings-text"
                  value={settings.codeRunTimeoutSecs}
                  onChange={(e) => void update({ codeRunTimeoutSecs: Number(e.target.value) || 1 })}
                />
              </span>
            </label>

          </div>

          <h4 className="settings-group-title">Command line</h4>
          <div className="settings-card">
            <label className="settings-row">
              <span>
                Allow CLI access
                <small>
                  Lets the <code>nullnotes</code> command read and edit your notes while the app runs. Applies on
                  next launch.
                </small>
              </span>
              <span className="settings-row-control">
                <input
                  type="checkbox"
                  checked={settings.cliAccess}
                  onChange={(e) => void update({ cliAccess: e.target.checked })}
                />
              </span>
            </label>
          </div>

          <h4 className="settings-group-title">Diagnostics</h4>
          <div className="settings-card">
            <label className="settings-row">
              <span>
                Error log
                <small>Errors captured from this app, kept on this machine for later triage.</small>
              </span>
              <span className="settings-row-control">
                <button className="dialog-action" onClick={() => setShowErrorLog(true)}>
                  View error log
                </button>
              </span>
            </label>
          </div>
          </>
          )}

          {currentId === 'shortcuts' && (
            <KeymapSettings overrides={settings.keymap} onChange={(keymap) => void update({ keymap })} />
          )}

          {currentId === 'git' && (
            <div className="settings-card">
              {repoMode === null && workspacePath && (
                <div className="settings-row">
                  <span>
                    This workspace isn&apos;t a Git repository yet
                    <small>
                      Turn it into one — private by default if you have the GitHub CLI installed, local-only
                      otherwise.
                    </small>
                  </span>
                  <button
                    className="dialog-action"
                    onClick={() => {
                      void (async () => {
                        const proceed = await confirm(`Initialize a Git repository in ${workspacePath}?`)
                        if (!proceed) return
                        const wantsRemote = await confirm(
                          'Also create a private GitHub remote via `gh`? (Cancel = local-only)',
                        )
                        const outcome = await api.git.initNotesRepo(workspacePath, wantsRemote)
                        if (outcome.kind === 'initializedLocalOnly') {
                          await message(`Repo created locally. To add a remote later:\n${outcome.remoteAddCommand}`)
                        }
                        useWorkspaceStore.getState().setRepoMode('notesOnly')
                      })()
                    }}
                  >
                    Initialize Git repo
                  </button>
                </div>
              )}

              {repoMode && (
                <label className="settings-row">
                  <span>
                    Auto-commit this workspace
                    <small>
                      {repoMode === 'notesOnly'
                        ? 'This workspace is its own Git repository.'
                        : repoMode === 'notesMonorepo'
                          ? 'This repository holds nothing but sibling note workspaces — auto-commit stays scoped to this one, and auto-push works here too.'
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
                        onChange={(e) =>
                          void updateGit({ idleMinutes: clampNumber(Number(e.target.value), 1, 120) })
                        }
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

                  {(repoMode === 'notesOnly' || repoMode === 'notesMonorepo') && (
                    <label className="settings-row">
                      <span>
                        Push after commit
                        <small>
                          {repoMode === 'notesMonorepo'
                            ? 'This repo holds nothing but sibling note workspaces, so it gets the same push treatment as a notes-only repo.'
                            : 'Only ever applies to a notes-only repo.'}{' '}
                          A shared code repo never auto-pushes unless you explicitly allow it below.
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

                  {repoMode === 'codeRepo' && (
                    <>
                      <label className="settings-row">
                        <span>
                          Allow pushing this workspace
                          <small>
                            This pushes directly into a shared repository other people may read the log
                            of — off by default for exactly that reason. Only enable it if you&apos;re
                            sure this repo is yours to push to.
                          </small>
                        </span>
                        <span className="settings-row-control">
                          <input
                            type="checkbox"
                            checked={gitAllowCodeRepoPush}
                            onChange={(e) => {
                              if (!e.target.checked) {
                                void updateGit({ allowCodeRepoPush: false })
                                return
                              }
                              void (async () => {
                                const proceed = await confirm(
                                  'This will push commits directly into a shared repository other people may read the log of. Allow auto-push for this workspace?',
                                )
                                if (proceed) await updateGit({ allowCodeRepoPush: true })
                              })()
                            }}
                          />
                        </span>
                      </label>

                      {gitAllowCodeRepoPush && (
                        <label className="settings-row">
                          <span>
                            Push after commit
                            <small>Now allowed for this workspace — push after each auto-commit.</small>
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
                </>
              )}
            </div>
          )}

          {currentId === 'about' && <AboutSettings />}

          {error && <p className="settings-error">{error}</p>}
        </div>
        </div>
      </DialogContent>
    </Dialog>
    {showErrorLog && <ErrorLogDialog onClose={() => setShowErrorLog(false)} />}
    </>
  )
}
