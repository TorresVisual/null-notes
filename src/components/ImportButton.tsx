import { useState } from 'react'
import { FileUp } from 'lucide-react'
import { usePdfImport } from '../pdf/usePdfImport'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useSettingsStore } from '../store/settings'
import { ImportModeDialog } from './ImportModeDialog'
import { api } from '../lib/tauri'
import type { PdfPage } from '../pdf/types'
import type { PdfImportMode } from '../types'

export function pagesToMarkdown(pages: PdfPage[]): string {
  return pages
    .map((p) => `\`\`\`pdf-page\n${JSON.stringify({ src: p.path, width: p.width, height: p.height })}\n\`\`\``)
    .join('\n\n')
}

interface PickedPdf {
  path: string
  title: string
}

export function ImportButton() {
  const { pickPdf, importPages, isImporting, progress } = usePdfImport()
  const workspacePath = useWorkspaceStore((s) => s.path)
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder)
  const addNote = useNotesStore((s) => s.addNote)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const settings = useSettingsStore((s) => s.settings)
  const setSettings = useSettingsStore((s) => s.setSettings)
  const [pending, setPending] = useState<PickedPdf | null>(null)
  const [scanned, setScanned] = useState<PickedPdf | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isConverting, setIsConverting] = useState(false)

  async function handleClick() {
    if (!workspacePath) return
    setError(null)
    const picked = await pickPdf()
    if (picked) setPending(picked)
  }

  // Pages: each page renders to an image in the note's sidecar and is inserted
  // as a viewable block. Markdown: the PDF's own text layer is reconstructed
  // into an ordinary editable note, equations included — no OCR, no image
  // crops, so the note stays plain, copyable Markdown throughout.
  async function runImport(picked: PickedPdf, mode: PdfImportMode) {
    if (!workspacePath) return
    setPending(null)
    setScanned(null)
    setError(null)

    if (mode !== settings.pdfImportMode) {
      const next = { ...settings, pdfImportMode: mode }
      setSettings(next)
      void api.settings.save(next)
    }

    try {
      // Markdown mode converts before the note exists, so a PDF with nothing
      // to convert — a scan, or a genuine failure — never leaves an empty
      // note behind.
      let body: string | null = null
      if (mode === 'markdown') {
        setIsConverting(true)
        const convertible = await api.pdf.hasTextLayer(picked.path).finally(() => {
          setIsConverting(false)
        })
        if (!convertible) {
          setScanned(picked)
          return
        }
        setIsConverting(true)
        body = await api.pdf.importMarkdown(picked.path).finally(() => setIsConverting(false))
      }

      const folder = selectedFolder ?? workspacePath
      const note = await api.notes.create(workspacePath, folder, picked.title)

      const content =
        body !== null
          ? `# ${picked.title}\n\n${body}`
          : `# ${picked.title}\n\n${pagesToMarkdown(await importPages(picked.path, note.path))}\n`

      await api.notes.save(note.path, content)
      await api.notes.reindex(note.path, workspacePath, content)
      addNote({ ...note, title: picked.title })
      openTab(note.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const busy = isImporting || isConverting

  return (
    <div className="import-pdf">
      {pending && (
        <ImportModeDialog
          fileName={pending.title}
          initialMode={settings.pdfImportMode}
          onChoose={(mode) => void runImport(pending, mode)}
          onCancel={() => setPending(null)}
        />
      )}
      <button onClick={() => void handleClick()} disabled={busy || !workspacePath}>
        <FileUp size={14} /> {busy ? 'Importing…' : 'Import PDF'}
      </button>
      {/* Naming Pages mode without offering it would leave the user stuck on a
          message; the button is the whole point of detecting this early. */}
      {scanned && (
        <div className="import-fallback">
          <p>
            <strong>{scanned.title}</strong> has no text layer — it looks like a scan, so there
            is nothing to convert.
          </p>
          <div className="import-fallback-actions">
            <button onClick={() => void runImport(scanned, 'pages')}>Import as pages</button>
            <button onClick={() => setScanned(null)}>Cancel</button>
          </div>
        </div>
      )}
      {isConverting && <p className="import-progress">Reading text layer…</p>}
      {isImporting && progress && (
        <p className="import-progress">
          Rendering page {progress.page}/{progress.totalPages}
        </p>
      )}
      {error && <p className="import-error">{error}</p>}
    </div>
  )
}
