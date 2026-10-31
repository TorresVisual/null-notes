import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/tauri'
import { isSafeWorkspacePath, type Canvas } from '../lib/jsonCanvas'

/**
 * Which file cards point at a real file. Card paths come from a file an agent
 * writes, so an unsafe or unresolvable path simply never appears here and the
 * card renders inert.
 */
export function useCanvasFileStatus(workspace: string | null, canvasPath: string, canvas: Canvas) {
  const [status, setStatus] = useState<Record<string, boolean>>({})
  const key = useMemo(() => {
    const files = canvas.nodes.flatMap((n) =>
      n.type === 'file' && typeof n.file === 'string' && isSafeWorkspacePath(n.file) ? [n.file] : [],
    )
    return [...new Set(files)].join('\n')
  }, [canvas.nodes])

  useEffect(() => {
    if (!workspace || key === '') {
      setStatus({})
      return
    }
    const files = key.split('\n')
    let stale = false
    api.notes
      .resolveCodeLinks(workspace, canvasPath, files.map((target) => ({ target, line: null })))
      .then((answers) => {
        if (!stale) setStatus(Object.fromEntries(files.map((f, i) => [f, answers[i] === 'ok'])))
      })
      .catch(() => {
        if (!stale) setStatus({})
      })
    return () => {
      stale = true
    }
  }, [workspace, canvasPath, key])

  return status
}
