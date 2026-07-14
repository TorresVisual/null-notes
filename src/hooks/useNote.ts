import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'

export function useNote(path: string | null) {
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const workspacePath = useWorkspaceStore((s) => s.path)

  useEffect(() => {
    if (!path) return
    setIsLoading(true)
    api.notes.open(path)
      .then(setContent)
      .finally(() => setIsLoading(false))
  }, [path])

  const save = useCallback(
    async (markdown: string) => {
      if (!path || !workspacePath) return
      setContent(markdown)
      await api.notes.save(path, workspacePath, markdown)
    },
    [path, workspacePath],
  )

  return { content, save, isLoading }
}
