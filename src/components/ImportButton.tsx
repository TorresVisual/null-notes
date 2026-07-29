import { useState } from 'react'
import { FileUp } from 'lucide-react'
import { usePdfImport } from '../pdf/usePdfImport'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { api } from '../lib/tauri'
import type { PdfPage } from '../pdf/types'

export function pagesToMarkdown(pages: PdfPage[]): string {
  return pages
    .map((p) => `\`\`\`pdf-page\n${JSON.stringify({ src: p.path, width: p.width, height: p.height })}\n\`\`\``)
    .join('\n\n')
}

export function ImportButton() {
  const { pickPdf, importPages, isImporting, progress } = usePdfImport()
  const workspacePath = useWorkspaceStore((s) => s.path)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const addNote = useNotesStore((s) => s.addNote)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const [error, setError] = useState<string | null>(null)

  // A PDF is imported as a reference: pages render to images stored beside
  // the note (like ink sketches) and are inserted as viewable blocks — no
  // OCR, no equation extraction, nothing that needs an external binary.
  async function handleImport() {
    if (!workspacePath) return
    setError(null)
    try {
      const picked = await pickPdf()
      if (!picked) return
      const folder = selectedFolder ?? workspacePath
      const note = await api.notes.create(workspacePath, folder, picked.title)
      const pages = await importPages(picked.path, note.path)
      const content = `# ${picked.title}\n\n${pagesToMarkdown(pages)}\n`
      await api.notes.save(note.path, content)
      await api.notes.reindex(note.path, workspacePath, content)
      addNote({ ...note, title: picked.title })
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
        <FileUp size={14} /> {isImporting ? 'Importing…' : 'Import PDF'}
      </button>
      {isImporting && progress && (
        <p className="import-progress">
          Rendering page {progress.page}/{progress.totalPages}
        </p>
      )}
      {error && <p className="import-error">{error}</p>}
    </div>
  )
}
