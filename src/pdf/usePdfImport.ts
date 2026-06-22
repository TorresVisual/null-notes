import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import type { ImportResult, PipelineProgress } from './types'

export function usePdfImport() {
  const [progress, setProgress] = useState<PipelineProgress | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  const importPdf = useCallback(async (): Promise<ImportResult | null> => {
    const selected = await open({
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      multiple: false,
    })
    if (!selected || Array.isArray(selected)) return null

    setIsImporting(true)
    const unlisten = await listen<PipelineProgress>('pdf://progress', (e) => {
      setProgress(e.payload)
    })

    try {
      return await invoke<ImportResult>('import_pdf', { pdfPath: selected })
    } finally {
      unlisten()
      setIsImporting(false)
      setProgress(null)
    }
  }, [])

  return { importPdf, isImporting, progress }
}
