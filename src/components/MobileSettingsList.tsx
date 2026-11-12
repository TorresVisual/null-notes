import { ChevronRight, X, type LucideIcon } from 'lucide-react'
import { DialogTitle } from './ui/dialog'
import type { SectionId } from '../store/settingsNav'

interface MobileSettingsListProps {
  sections: { id: SectionId; label: string; Icon: LucideIcon; summary: string }[]
  onSelect: (id: SectionId) => void
  onReset: () => void
  onClose: () => void
}

export function MobileSettingsList({ sections, onSelect, onReset, onClose }: MobileSettingsListProps) {
  return (
    <>
      <header className="mobile-topbar">
        <button className="mobile-topbar-back" onClick={onClose} aria-label="Close settings">
          <X size={20} />
        </button>
        <DialogTitle asChild>
          <h2 className="mobile-topbar-title">Settings</h2>
        </DialogTitle>
      </header>
      <nav className="settings-list" aria-label="Settings sections">
        <div className="settings-list-group">
          {sections.map(({ id, label, Icon, summary }) => (
            <button key={id} className="settings-list-row" onClick={() => onSelect(id)}>
              <span className="settings-list-icon">
                <Icon size={16} />
              </span>
              <span className="settings-list-text">
                {label}
                <small>{summary}</small>
              </span>
              <ChevronRight size={18} className="settings-list-chevron" />
            </button>
          ))}
        </div>
        <button className="settings-reset settings-list-reset" onClick={onReset}>
          Reset to defaults
        </button>
      </nav>
    </>
  )
}
