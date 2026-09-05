import { useEffect, useState } from 'react'
import { api } from '../lib/tauri'

function isExternal(src: string): boolean {
  return /^(https?:|data:)/.test(src)
}

// Resolves a note-relative asset path (image sidecar) to a displayable src.
// External URLs pass through unchanged; anything else is read from disk and
// turned into a data URI, since the renderer has no other way to reach a
// path inside the OS filesystem.
export function useResolvedAssetSrc(
  notePath: string,
  src: string,
): { resolved: string | null; failed: boolean } {
  const [resolved, setResolved] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setResolved(null)
    setFailed(false)
    if (!src) return
    if (isExternal(src)) {
      setResolved(src)
      return
    }
    api.assets
      .read(notePath, src)
      .then((base64) => {
        if (!cancelled) setResolved(`data:image;base64,${base64}`)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [src, notePath])

  return { resolved, failed }
}
