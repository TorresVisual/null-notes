import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { api } from '../lib/tauri'
import type { NoteMetadata } from '../types'

export function useEmbedSource(target: NoteMetadata | undefined): string | null {
  const [content, setContent] = useState<string | null>(null)
  const path = target?.path
  const workspace = target?.workspace

  useEffect(() => {
    if (!path || !workspace) {
      setContent(null)
      return
    }
    let cancelled = false
    const load = () =>
      api.notes.open(workspace, path).then((fresh) => {
        if (!cancelled) setContent(fresh)
      })
    void load()
    const unlisten = listen<string[]>('workspace-changed', (event) => {
      if (event.payload.includes(path)) void load()
    })
    return () => {
      cancelled = true
      void unlisten.then((off) => off())
    }
  }, [path, workspace])

  return content
}
