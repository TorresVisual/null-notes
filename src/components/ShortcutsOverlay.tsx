interface ShortcutsOverlayProps {
  onClose: () => void
}

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'Ctrl N', label: 'New note' },
  { keys: 'Ctrl Shift N', label: 'New folder' },
  { keys: 'Ctrl O', label: 'Open workspace' },
  { keys: 'Ctrl K', label: 'Search notes' },
  { keys: 'Ctrl P', label: 'Jump to a note by title' },
  { keys: 'Ctrl E', label: 'Toggle source / preview' },
  { keys: 'Ctrl Shift I', label: 'Insert ink block' },
  { keys: 'Ctrl G', label: 'Connections graph' },
  { keys: 'Ctrl `', label: 'Toggle terminal' },
  { keys: 'Ctrl ,', label: 'Settings' },
  { keys: '?', label: 'Show this list' },
]

export function ShortcutsOverlay({ onClose }: ShortcutsOverlayProps) {
  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="settings-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>Keyboard Shortcuts</h2>
        </div>
        <ul className="shortcuts-list">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="shortcuts-row">
              <span>{s.label}</span>
              <kbd>{s.keys}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
