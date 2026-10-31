import { useMemo } from 'react'
import { COMMANDS, formatCombo, type CommandDef } from '../lib/keymap'
import { useKeymap } from '../hooks/useKeymap'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from './ui/command'

export interface PaletteContext {
  hasWorkspace: boolean
  hasNote: boolean
  repoMode: boolean
  tabPinned?: boolean
}

const NO_WORKSPACE_NEEDED = new Set(['open-workspace', 'settings', 'shortcuts-help', 'exit'])
const NEEDS_NOTE = new Set([
  'toggle-view',
  'insert-ink',
  'split-tasks',
  'extract-selection',
  'export-pdf',
  'print',
  'toggle-outline',
  'toggle-outgoing-links',
  'close-tab',
  'toggle-pin-tab',
  'next-tab',
  'prev-tab',
])

export function availableActions({ hasWorkspace, hasNote, repoMode, tabPinned }: PaletteContext): CommandDef[] {
  return COMMANDS
    .filter(
      (item) =>
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
  const keymap = useKeymap()
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
                {keymap[a.id] && (
                  <CommandShortcut className="palette-shortcut">{formatCombo(keymap[a.id])}</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandEmpty className="search-empty">No matching action</CommandEmpty>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
