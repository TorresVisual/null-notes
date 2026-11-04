export type CommandGroup = 'Create' | 'Navigate' | 'View' | 'Study' | 'Note' | 'Other'

export interface CommandDef {
  id: string
  label: string
  group: CommandGroup
  defaultKey?: string
}

/** Stored per command id; an empty string means "cleared", absence means "default". */
export type KeymapOverrides = Record<string, string>

const GOTO_TABS: CommandDef[] = Array.from({ length: 9 }, (_, i) => ({
  id: `goto-tab:${i + 1}`,
  label: i === 8 ? 'Go to Last Tab' : `Go to Tab ${i + 1}`,
  group: 'Navigate',
  defaultKey: `Ctrl+${i + 1}`,
}))

const def = (id: string, label: string, group: CommandGroup, defaultKey?: string): CommandDef => ({
  id,
  label,
  group,
  defaultKey,
})

// The single list every surface reads — Titlebar menus, palette, shortcut
// sheet, Settings and the keydown dispatcher. Order is palette order.
export const COMMANDS: CommandDef[] = [
  def('new-note', 'New Note', 'Create', 'Ctrl+N'),
  def('new-folder', 'New Folder', 'Create', 'Ctrl+Shift+N'),
  def('new-canvas', 'New Canvas Note', 'Create'),
  def('new-agent-canvas', 'New Agent Canvas', 'Create'),
  def('new-from-template', 'New from Template…', 'Create', 'Ctrl+Shift+T'),
  def('open-workspace', 'Open Workspace…', 'Navigate', 'Ctrl+O'),
  def('close-workspace', 'Close Workspace', 'Other'),
  def('add-property', 'Add Property', 'Note'),
  def('split-tasks', 'Split Into Tasks', 'Note'),
  def('format-note', 'Format Note', 'Note'),
  def('extract-selection', 'Extract Selection to New Note', 'Note'),
  def('generate-formula-sheet', 'Generate Formula Sheet…', 'Note'),
  def('generate-solutions-sheet', 'Generate Solutions Sheet…', 'Note'),
  def('export-pdf', 'Export to PDF…', 'Note'),
  def('print', 'Print…', 'Note'),
  def('trash', 'Trash…', 'Other'),
  def('settings', 'Settings…', 'Other', 'Ctrl+,'),
  def('exit', 'Exit', 'Other'),
  def('home', 'Home', 'Navigate', 'Ctrl+H'),
  def('search', 'Search', 'Navigate', 'Ctrl+K'),
  def('quick-switch', 'Quick Switcher', 'Navigate', 'Ctrl+P'),
  def('command-palette', 'Command Palette', 'Navigate', 'Ctrl+Shift+P'),
  def('toggle-view', 'Toggle Source/Preview', 'View', 'Ctrl+E'),
  def('insert-ink', 'Insert Ink Block', 'View', 'Ctrl+Shift+I'),
  def('graph-view', 'Connections Graph', 'View', 'Ctrl+G'),
  def('toggle-terminal', 'Toggle Terminal', 'View', 'Ctrl+`'),
  def('toggle-outline', 'Toggle Outline', 'View', 'Ctrl+Shift+O'),
  def('toggle-outgoing-links', 'Toggle Outgoing Links', 'View'),
  def('toggle-sidebar', 'Toggle Sidebar', 'View', 'Ctrl+\\'),
  def('task-view', 'Tasks', 'Study', 'Ctrl+Shift+K'),
  def('review', 'Review', 'Study', 'Ctrl+Shift+R'),
  def('deck-view', 'Browse All Cards', 'Study', 'Ctrl+Shift+D'),
  def('shortcuts-help', 'Keyboard Shortcuts', 'Other', '?'),
  def('close-tab', 'Close Tab', 'Navigate', 'Ctrl+W'),
  def('toggle-pin-tab', 'Pin Tab', 'Navigate'),
  ...GOTO_TABS,
  def('reopen-closed-tab', 'Reopen Closed Tab', 'Navigate', 'Ctrl+Shift+W'),
  def('next-tab', 'Next Tab', 'Navigate', 'Ctrl+Tab'),
  def('prev-tab', 'Previous Tab', 'Navigate', 'Ctrl+Shift+Tab'),
  def('nav-back', 'Go Back', 'Navigate', 'Alt+ArrowLeft'),
  def('nav-forward', 'Go Forward', 'Navigate', 'Alt+ArrowRight'),
  def('fold-all', 'Fold All Headings and Lists', 'View'),
  def('unfold-all', 'Unfold All Headings and Lists', 'View'),
  def('toggle-focus-mode', 'Toggle Focus Mode', 'View', 'Ctrl+Shift+F'),
  def('sync-now', 'Sync Now', 'Other'),
  def('note-bookmark', 'Toggle Note Bookmark', 'Note'),
  def('note-duplicate', 'Duplicate Note', 'Note'),
  def('note-move', 'Move Note to…', 'Note'),
  def('note-merge', 'Merge Note Into…', 'Note'),
  def('note-rename', 'Rename Note', 'Note'),
  def('note-delete', 'Delete Note', 'Note'),
  def('note-reveal', 'Show Note in File Explorer', 'Note'),
  def('note-open-external', 'Open Note in Default App', 'Note'),
  def('note-copy-path', 'Copy Note Path', 'Note'),
  def('note-copy-relative-path', 'Copy Note Relative Path', 'Note'),
]

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]))

export function commandById(id: string): CommandDef | undefined {
  return BY_ID.get(id)
}

/** Command id → combo for every command; unbound commands map to ''. */
export function effectiveKeymap(overrides: KeymapOverrides | undefined): Record<string, string> {
  return Object.fromEntries(COMMANDS.map((c) => [c.id, overrides?.[c.id] ?? c.defaultKey ?? '']))
}

// Meta folds into Ctrl, as the old dispatcher did, so one binding covers both.
// Shift is dropped for punctuation: `e.key` already reports `?` for Shift+/,
// and keeping both would make the combo layout-dependent twice over.
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS', 'Dead', 'Unidentified'].includes(e.key)) return null
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  const shift = e.shiftKey && (e.key.length > 1 || /[\p{L}\p{N}]/u.test(e.key))
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', shift ? 'Shift' : '', key]
    .filter(Boolean)
    .join('+')
}

const ARROWS: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }

export function formatCombo(combo: string | undefined): string {
  return (combo ?? '')
    .split('+')
    .map((part) => ARROWS[part] ?? part)
    .join('+')
}

const RESERVED = new Set([
  'Ctrl+A',
  'Ctrl+C',
  'Ctrl+V',
  'Ctrl+X',
  'Ctrl+Y',
  'Ctrl+Z',
  'Ctrl+Shift+Z',
  'Ctrl+F',
  'Ctrl+B',
  'Ctrl+I',
  'Ctrl+U',
  'Alt+Tab',
  'Alt+F4',
])

/** Ctrl/Alt combos and F-keys fire anywhere; anything else is typing and must not fire in a text field. */
export function isGlobalCombo(combo: string): boolean {
  return /^(Ctrl|Alt)\+/.test(combo) || /^F\d+$/.test(combo)
}

/** Why `combo` can't be bound to `id`, or null if it can. */
export function bindingError(bindings: Record<string, string>, id: string, combo: string): string | null {
  if (RESERVED.has(combo)) return `${formatCombo(combo)} is reserved for editing`
  if (!isGlobalCombo(combo)) return 'Include Ctrl or Alt (or use an F-key)'
  const clash = COMMANDS.find((c) => c.id !== id && bindings[c.id] === combo)
  return clash ? `Already used by “${clash.label}”` : null
}
