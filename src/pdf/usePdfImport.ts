import { useState, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { api } from '../lib/tauri'
import type { PdfPage, PdfImportProgress } from './types'

interface PickedPdf {
  path: string
  title: string
}

// The dialog returns a full OS path; the note title is the filename with
// its extension stripped, matching how create_note derives a filename back
// from a title (this just runs the mapping in the other direction first).
export function titleFromPdfPath(path: string): string {
  const filename = path.split(/[\\/]/).pop() ?? path
  return filename.replace(/\.pdf$/i, '')
}

export function usePdfImport() {
  const [progress, setProgress] = useState<PdfImportProgress | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  const pickPdf = useCallback(async (): Promise<PickedPdf[] | null> => {
    const selected = await open({
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      multiple: true,
    })
    if (!selected) return null
    const paths = Array.isArray(selected) ? selected : [selected]
    return paths.map((path) => ({ path, title: titleFromPdfPath(path) }))
  }, [])

  const importPages = useCallback(async (pdfPath: string, notePath: string): Promise<PdfPage[]> => {
    setIsImporting(true)
    const unlisten = await listen<PdfImportProgress>('pdf://progress', (e) => {
      setProgress(e.payload)
    })

    try {
      return await api.pdf.importPages(pdfPath, notePath)
    } finally {
      unlisten()
      setIsImporting(false)
      setProgress(null)
    }
  }, [])

  return { pickPdf, importPages, isImporting, progress }
}
