import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { topLevelFolders } from '../lib/formulaScope'

export interface FormulaScope {
  folder: string | null
  tag: string | null
}

interface FormulaScopePickerProps {
  scope: FormulaScope
  disabled: boolean
  onChange: (scope: FormulaScope) => void
}

export function FormulaScopePicker({ scope, disabled, onChange }: FormulaScopePickerProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const notes = useNotesStore((s) => s.notes)
  const folders = useNotesStore((s) => s.folders)
  const tags = useNotesStore((s) => s.tags)
  const folderRows = workspacePath ? topLevelFolders(workspacePath, folders, notes) : []

  return (
    <div className="mobile-scope" role="radiogroup" aria-label="Collect from">
      <div className="mobile-scope-label">Collect from</div>
      <button
        role="radio"
        aria-checked={!scope.folder && !scope.tag}
        className="mobile-scope-row"
        disabled={disabled}
        onClick={() => onChange({ folder: null, tag: null })}
      >
        <span className="mobile-scope-dot" />
        Whole workspace
        <span className="mobile-scope-meta">{notes.length}</span>
      </button>
      {folderRows.length > 0 && <div className="mobile-scope-label">Folders</div>}
      {folderRows.map((f) => (
        <button
          key={f.path}
          role="radio"
          aria-checked={scope.folder === f.path}
          className="mobile-scope-row"
          disabled={disabled}
          onClick={() => onChange({ folder: f.path, tag: null })}
        >
          <span className="mobile-scope-dot" />
          <span className="mobile-scope-name">{f.name}</span>
          <span className="mobile-scope-meta">{f.noteCount}</span>
        </button>
      ))}
      {tags.length > 0 && <div className="mobile-scope-label">Tags</div>}
      <div className="mobile-scope-chips">
        {tags.map((tag) => (
          <button
            key={tag}
            role="radio"
            aria-checked={scope.tag === tag}
            className="mobile-scope-chip"
            disabled={disabled}
            onClick={() => onChange({ folder: null, tag })}
          >
            #{tag}
          </button>
        ))}
      </div>
    </div>
  )
}
