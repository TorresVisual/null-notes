import { useState } from 'react'
import { usePdfImport } from '../pdf/usePdfImport'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import type { Exercise } from '../pdf/types'

function exercisesToMarkdown(exercises: Exercise[]): string {
  return exercises
    .map((ex) => {
      const body = ex.contentBlocks
        .map((b) => (b.isEquation && b.latex ? `$$${b.latex}$$` : b.text))
        .join('\n\n')
      return `## ${ex.title}\n\n${body}\n\n### Solution\n\n`
    })
    .join('---\n\n')
}

export function ImportButton() {
  const { importPdf, isImporting, progress } = usePdfImport()
  const workspacePath = useWorkspaceStore((s) => s.path)
  const addNote = useNotesStore((s) => s.addNote)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const [error, setError] = useState<string | null>(null)

  async function handleImport() {
    if (!workspacePath) return
    setError(null)
    try {
      const result = await importPdf()
      if (!result) return
      const content = `# ${result.title}\n\n${exercisesToMarkdown(result.exercises)}`
      const note = await api.notes.create(workspacePath, result.title)
      await api.notes.save(note.path, content)
      addNote({ ...note, title: result.title })
      openTab(note.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="import-pdf">
      <button
        onClick={() => void handleImport()}
        disabled={isImporting || !workspacePath}
      >
        {isImporting ? 'Importing…' : 'Import PDF'}
      </button>
      {isImporting && progress && (
        <p className="import-progress">
          {progress.stage} — {progress.page}/{progress.totalPages}
        </p>
      )}
      {error && <p className="import-error">{error}</p>}
    </div>
  )
}
