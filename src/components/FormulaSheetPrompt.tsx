import { useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/tauri'
import { failure } from '../lib/failure'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { parseSearchQuery } from '../lib/searchQuery'
import { folderScopeArg } from '../lib/formulaScope'
import { isMobile } from '../lib/platform'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { FormulaScopePicker, type FormulaScope } from './FormulaScopePicker'

interface FormulaSheetPromptProps {
  kind?: 'formula' | 'solutions'
  onClose: () => void
}

// A single input reusing P6-5's folder:/tag: syntax (`parseSearchQuery`)
// rather than a dedicated scope picker — blank means the whole workspace.
// `type:` and free text are accepted but ignored; only folder/tag narrow
// what a sheet collects from. `kind="solutions"` reuses the same prompt to
// compile `### Solution` bodies instead of formulas.
export function FormulaSheetPrompt({ kind = 'formula', onClose }: FormulaSheetPromptProps) {
  const noun = kind === 'solutions' ? 'Solutions Sheet' : 'Formula Sheet'
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const addNote = useNotesStore((s) => s.addNote)
  const mobile = isMobile()
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<FormulaScope>({ folder: null, tag: null })
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  async function generate() {
    if (!workspacePath || isGenerating) return
    const { folder, tag } = mobile
      ? { folder: scope.folder && folderScopeArg(scope.folder), tag: scope.tag }
      : parseSearchQuery(query)
    setIsGenerating(true)
    setError(null)
    try {
      const generateSheet =
        kind === 'solutions' ? api.notes.generateSolutionsSheet : api.notes.generateFormulaSheet
      const meta = await generateSheet(workspacePath, folder, tag)
      addNote(meta)
      openTab(meta.path)
      onClose()
    } catch (e) {
      setError(failure(`generate the ${noun.toLowerCase()}`, e))
      setIsGenerating(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="formula-sheet-prompt" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Generate {noun}</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {mobile ? (
          <FormulaScopePicker scope={scope} disabled={isGenerating} onChange={setScope} />
        ) : (
          <>
            <p className="formula-sheet-prompt-hint">
              Narrow with <code>folder:</code> or <code>tag:</code> — leave blank for the whole workspace.
            </p>
            <input
              type="text"
              className="formula-sheet-prompt-input"
              value={query}
              placeholder="folder:Course101"
              autoFocus
              disabled={isGenerating}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void generate()
              }}
            />
          </>
        )}
        {error && <p className="formula-sheet-prompt-error">{error}</p>}
        <div className="formula-sheet-prompt-actions">
          {!mobile && <button className="dialog-action" onClick={onClose}>Cancel</button>}
          <button className="dialog-action-primary" onClick={() => void generate()} disabled={isGenerating}>
            {isGenerating ? 'Generating…' : mobile ? `Generate ${noun.toLowerCase()}` : 'Generate'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
