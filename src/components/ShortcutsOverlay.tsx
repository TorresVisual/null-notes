import { X } from 'lucide-react'
import { COMMANDS, formatCombo, type CommandGroup } from '../lib/keymap'
import { useKeymap } from '../hooks/useKeymap'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface ShortcutsOverlayProps {
  onClose: () => void
}

const GROUPS: CommandGroup[] = ['Create', 'Navigate', 'View', 'Study', 'Note', 'Other']

// Find lives in the editor itself, so it is shown here but not rebindable.
const FIXED_SHORTCUTS = [
  { keys: 'Ctrl+F', label: 'Find (and replace) in this note', group: 'Navigate' },
  { keys: 'Space / Enter', label: 'Review: reveal answer, submit, next card', group: 'Study' },
  { keys: '1 – 4', label: 'Review: grade Again / Hard / Good / Easy (multiple choice: toggle option)', group: 'Study' },
  { keys: 'Ctrl+Z', label: 'Review: undo last grade', group: 'Study' },
]

export function ShortcutsOverlay({ onClose }: ShortcutsOverlayProps) {
  const keymap = useKeymap()
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="settings-panel" showCloseButton={false} aria-describedby={undefined}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Keyboard Shortcuts</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close shortcuts" title="Close shortcuts">
            <X size={16} />
          </button>
        </div>
        <div className="settings-panel-body" tabIndex={0} role="region" aria-label="Shortcut list">
          {GROUPS.map((group) => {
            const shortcuts = [
              ...COMMANDS.filter((c) => c.group === group && keymap[c.id]).map((c) => ({
                label: c.label,
                keys: formatCombo(keymap[c.id]),
              })),
              ...FIXED_SHORTCUTS.filter((s) => s.group === group),
            ]
            if (!shortcuts.length) return null
            return (
              <div className="settings-section" key={group}>
                <p className="section-label">{group}</p>
                <ul className="shortcuts-list">
                  {shortcuts.map((s) => (
                    <li key={s.label} className="shortcuts-row">
                      <span>{s.label}</span>
                      <kbd>{s.keys}</kbd>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
