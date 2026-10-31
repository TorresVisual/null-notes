import { useCallback, useEffect, useRef } from 'react'
import type { Viewport } from '@xyflow/react'
import { useWorkspaceStore } from '../store/workspace'

const SAVE_DELAY_MS = 500

/** The pan/zoom to restore on open, and a move-end handler that remembers the new one. */
export function useCanvasViewport(path: string) {
  const initial = useRef(useWorkspaceStore.getState().canvasViewports[path])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => useWorkspaceStore.getState().setCanvasViewport(path, viewport), SAVE_DELAY_MS)
    },
    [path],
  )

  return { initial: initial.current, onMoveEnd }
}
