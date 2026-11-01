import { COMMANDS, formatCombo, type CommandGroup } from '../lib/keymap'
import { useKeymap } from '../hooks/useKeymap'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface ShortcutsOverlayProps {
  onClose: () => void
}

const GROUPS: CommandGroup[] = ['Create', 'Navigate', 'View', 'Study', 'Note', 'Other']

// Find lives in the editor itself, so it is shown here but not rebindable.
const FIXED_SHORTCUTS = [{ keys: 'Ctrl+F', label: 'Find (and replace) in this note', group: 'Navigate' }]

export function ShortcutsOverlay({ onClose }: ShortcutsOverlayProps) {
  const keymap = useKeymap()
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="settings-panel" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Keyboard Shortcuts</h2>
          </DialogTitle>
        </div>
        <div className="settings-panel-body">
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
