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
    let latest = 0
    // A failed read (the target was just deleted) drops the stale excerpt; the
    // notes store then removes the target and the view falls to "not found".
    // Only the newest request may write, so overlapping reads can't reorder.
    const load = () => {
      const mine = ++latest
      return api.notes
        .open(workspace, path)
        .then((fresh) => (cancelled || mine !== latest ? undefined : setContent(fresh)))
        .catch(() => (cancelled || mine !== latest ? undefined : setContent(null)))
    }
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
