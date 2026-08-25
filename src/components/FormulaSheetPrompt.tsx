import { useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { parseSearchQuery } from '../lib/searchQuery'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface FormulaSheetPromptProps {
  onClose: () => void
}

// A single input reusing P6-5's folder:/tag: syntax (`parseSearchQuery`)
// rather than a dedicated scope picker — blank means the whole workspace.
// `type:` and free text are accepted but ignored; only folder/tag narrow
// what a formula sheet collects from.
export function FormulaSheetPrompt({ onClose }: FormulaSheetPromptProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const addNote = useNotesStore((s) => s.addNote)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  async function generate() {
    if (!workspacePath || isGenerating) return
    const { folder, tag } = parseSearchQuery(query)
    setIsGenerating(true)
    setError(null)
    try {
      const meta = await api.notes.generateFormulaSheet(workspacePath, folder, tag)
      addNote(meta)
      openTab(meta.path)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setIsGenerating(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="formula-sheet-prompt" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>Generate Formula Sheet</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
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
        {error && <p className="formula-sheet-prompt-error">{error}</p>}
        <div className="formula-sheet-prompt-actions">
          <button className="dialog-action" onClick={onClose}>Cancel</button>
          <button className="dialog-action-primary" onClick={() => void generate()} disabled={isGenerating}>
            {isGenerating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
