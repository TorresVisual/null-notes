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

  async function handleImport() {
    if (!workspacePath) return
    const result = await importPdf()
    if (!result) return

    const content = `# ${result.title}\n\n${exercisesToMarkdown(result.exercises)}`
    const note = await api.notes.create(workspacePath, result.title)
    await api.notes.save(note.path, content)
    addNote({ ...note, title: result.title })
    openTab(note.path)
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
    </div>
  )
}
