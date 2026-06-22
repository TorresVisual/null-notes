import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/tauri'

export function useNote(path: string | null) {
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!path) return
    setIsLoading(true)
    api.notes.open(path)
      .then(setContent)
      .finally(() => setIsLoading(false))
  }, [path])

  const save = useCallback(
    async (markdown: string) => {
      if (!path) return
      setContent(markdown)
      await api.notes.save(path, markdown)
    },
    [path],
  )

  return { content, save, isLoading }
}
