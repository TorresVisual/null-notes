import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface ShortcutsOverlayProps {
  onClose: () => void
}

interface ShortcutGroup {
  label: string
  shortcuts: Array<{ keys: string; label: string }>
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: 'Create',
    shortcuts: [
      { keys: 'Ctrl N', label: 'New note' },
      { keys: 'Ctrl Shift N', label: 'New folder' },
      { keys: 'Ctrl Shift T', label: 'New from template' },
    ],
  },
  {
    label: 'Navigate',
    shortcuts: [
      { keys: 'Ctrl O', label: 'Open workspace' },
      { keys: 'Ctrl K', label: 'Search notes' },
      { keys: 'Ctrl F', label: 'Find (and replace) in this note' },
      { keys: 'Alt ←', label: 'Back (undo a wiki-link / cross-reference jump)' },
      { keys: 'Alt →', label: 'Forward' },
      { keys: 'Ctrl P', label: 'Jump to a note by title' },
      { keys: 'Ctrl H', label: 'Home' },
      { keys: 'Ctrl W', label: 'Close tab' },
      { keys: 'Ctrl Shift W', label: 'Reopen closed tab' },
      { keys: 'Ctrl Tab', label: 'Next tab' },
      { keys: 'Ctrl Shift Tab', label: 'Previous tab' },
    ],
  },
  {
    label: 'View',
    shortcuts: [
      { keys: 'Ctrl E', label: 'Toggle source / preview' },
      { keys: 'Ctrl Shift I', label: 'Insert ink block' },
      { keys: 'Ctrl G', label: 'Connections graph' },
      { keys: 'Ctrl `', label: 'Toggle terminal' },
      { keys: 'Ctrl Shift O', label: 'Toggle outline' },
      { keys: 'Ctrl Shift F', label: 'Toggle focus mode' },
      { keys: 'Ctrl \\', label: 'Toggle sidebar' },
    ],
  },
  {
    label: 'Study',
    shortcuts: [
      { keys: 'Ctrl Shift K', label: 'Tasks' },
      { keys: 'Ctrl Shift R', label: 'Review' },
      { keys: 'Ctrl Shift D', label: 'All Cards' },
    ],
  },
  {
    label: 'Other',
    shortcuts: [
      { keys: 'Ctrl ,', label: 'Settings' },
      { keys: '?', label: 'Show this list' },
    ],
  },
]

export function ShortcutsOverlay({ onClose }: ShortcutsOverlayProps) {
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="settings-panel" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Keyboard Shortcuts</h2>
          </DialogTitle>
        </div>
        {SHORTCUT_GROUPS.map((group) => (
          <div className="settings-section" key={group.label}>
            <p className="section-label">{group.label}</p>
            <ul className="shortcuts-list">
              {group.shortcuts.map((s) => (
                <li key={s.label} className="shortcuts-row">
                  <span>{s.label}</span>
                  <kbd>{s.keys}</kbd>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </DialogContent>
    </Dialog>
  )
}
