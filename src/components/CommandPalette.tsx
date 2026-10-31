import { useMemo } from 'react'
import { buildFileMenu, VIEW_MENU, type MenuEntry } from './Titlebar'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from './ui/command'

export interface PaletteContext {
  hasWorkspace: boolean
  hasNote: boolean
  repoMode: boolean
}

// Shortcut-only and git actions: not in the Titlebar menus, but routed
// through the same runCommand ids.
const EXTRA_ACTIONS: MenuEntry[] = [
  { id: 'close-tab', label: 'Close Tab', accel: 'Ctrl+W' },
  { id: 'reopen-closed-tab', label: 'Reopen Closed Tab', accel: 'Ctrl+Shift+W' },
  { id: 'next-tab', label: 'Next Tab', accel: 'Ctrl+Tab' },
  { id: 'prev-tab', label: 'Previous Tab', accel: 'Ctrl+Shift+Tab' },
  { id: 'toggle-focus-mode', label: 'Toggle Focus Mode', accel: 'Ctrl+Shift+F' },
  { id: 'sync-now', label: 'Sync Now' },
]

const NO_WORKSPACE_NEEDED = new Set(['open-workspace', 'settings', 'shortcuts-help', 'exit'])
const NEEDS_NOTE = new Set([
  'toggle-view',
  'insert-ink',
  'split-tasks',
  'export-pdf',
  'print',
  'toggle-outline',
  'close-tab',
  'next-tab',
  'prev-tab',
])

export function availableActions({ hasWorkspace, hasNote, repoMode }: PaletteContext): MenuEntry[] {
  return [...buildFileMenu([]), ...VIEW_MENU, ...EXTRA_ACTIONS].filter(
    (item): item is MenuEntry =>
      'id' in item &&
      item.id !== 'command-palette' &&
      (hasWorkspace || NO_WORKSPACE_NEEDED.has(item.id)) &&
      (hasNote || !NEEDS_NOTE.has(item.id)) &&
      (repoMode || item.id !== 'sync-now'),
  )
}

interface CommandPaletteProps extends PaletteContext {
  onRun: (id: string) => void
  onClose: () => void
}

export function CommandPalette({ hasWorkspace, hasNote, repoMode, onRun, onClose }: CommandPaletteProps) {
  const actions = useMemo(
    () => availableActions({ hasWorkspace, hasNote, repoMode }),
    [hasWorkspace, hasNote, repoMode],
  )

  // Close first: a command that opens its own overlay must win the single
  // overlay slot, not be closed by this one afterwards.
  function run(id: string) {
    onClose()
    onRun(id)
  }

  return (
    <CommandDialog
      open
      onOpenChange={(next) => !next && onClose()}
      className="search-modal"
      title="Command palette"
      description="Search for an action to run"
    >
      <Command>
        <CommandInput className="search-modal-input" placeholder="Run an action…" />
        <CommandList className="search-results">
          <CommandGroup>
            {actions.map((a) => (
              <CommandItem
                key={a.id}
                value={a.label}
                className="palette-item [&>svg]:hidden"
                onSelect={() => run(a.id)}
              >
                <span className="palette-label">{a.label}</span>
                {a.accel && <CommandShortcut className="palette-shortcut">{a.accel}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandEmpty className="search-empty">No matching action</CommandEmpty>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
