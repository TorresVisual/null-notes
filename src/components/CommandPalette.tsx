import { useMemo } from 'react'
import { buildFileMenu, VIEW_MENU, type MenuEntry } from './Titlebar'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from './ui/command'

export interface PaletteContext {
  hasWorkspace: boolean
  hasNote: boolean
  repoMode: boolean
  tabPinned?: boolean
}

// Ctrl+1..8 jump to that tab, Ctrl+9 to the last one.
const GOTO_TAB_ACTIONS: MenuEntry[] = Array.from({ length: 9 }, (_, i) => ({
  id: `goto-tab:${i + 1}`,
  label: i === 8 ? 'Go to Last Tab' : `Go to Tab ${i + 1}`,
  accel: `Ctrl+${i + 1}`,
}))

// Shortcut-only and git actions: not in the Titlebar menus, but routed
// through the same runCommand ids.
const EXTRA_ACTIONS: MenuEntry[] = [
  { id: 'close-tab', label: 'Close Tab', accel: 'Ctrl+W' },
  { id: 'toggle-pin-tab', label: 'Pin Tab' },
  ...GOTO_TAB_ACTIONS,
  { id: 'reopen-closed-tab', label: 'Reopen Closed Tab', accel: 'Ctrl+Shift+W' },
  { id: 'next-tab', label: 'Next Tab', accel: 'Ctrl+Tab' },
  { id: 'prev-tab', label: 'Previous Tab', accel: 'Ctrl+Shift+Tab' },
  { id: 'toggle-focus-mode', label: 'Toggle Focus Mode', accel: 'Ctrl+Shift+F' },
  { id: 'sync-now', label: 'Sync Now' },
  { id: 'note-duplicate', label: 'Duplicate Note' },
  { id: 'note-move', label: 'Move Note to…' },
  { id: 'note-rename', label: 'Rename Note' },
  { id: 'note-delete', label: 'Delete Note' },
  { id: 'note-reveal', label: 'Show Note in File Explorer' },
  { id: 'note-open-external', label: 'Open Note in Default App' },
  { id: 'note-copy-path', label: 'Copy Note Path' },
  { id: 'note-copy-relative-path', label: 'Copy Note Relative Path' },
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
  'toggle-pin-tab',
  'next-tab',
  'prev-tab',
])

export function availableActions({ hasWorkspace, hasNote, repoMode, tabPinned }: PaletteContext): MenuEntry[] {
  return [...buildFileMenu([]), ...VIEW_MENU, ...EXTRA_ACTIONS]
    .filter(
      (item): item is MenuEntry =>
        'id' in item &&
        item.id !== 'command-palette' &&
        (hasWorkspace || NO_WORKSPACE_NEEDED.has(item.id)) &&
        (hasNote || !(NEEDS_NOTE.has(item.id) || item.id.startsWith('goto-tab:') || item.id.startsWith('note-'))) &&
        (repoMode || item.id !== 'sync-now'),
    )
    .map((item) => (item.id === 'toggle-pin-tab' && tabPinned ? { ...item, label: 'Unpin Tab' } : item))
}

interface CommandPaletteProps extends PaletteContext {
  onRun: (id: string) => void
  onClose: () => void
}

export function CommandPalette({ hasWorkspace, hasNote, repoMode, tabPinned, onRun, onClose }: CommandPaletteProps) {
  const actions = useMemo(
    () => availableActions({ hasWorkspace, hasNote, repoMode, tabPinned }),
    [hasWorkspace, hasNote, repoMode, tabPinned],
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
