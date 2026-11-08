import { useCallback, type MouseEvent, type RefObject } from 'react'
import { useWorkspaceStore } from '../store/workspace'

export function useSplitDivider(containerRef: RefObject<HTMLElement | null>, direction: 'row' | 'column') {
  const setSplitRatio = useWorkspaceStore((s) => s.setSplitRatio)

  const onMouseDown = useCallback(
    (e: MouseEvent) => {
      e.preventDefault()
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const onMove = (move: globalThis.MouseEvent) => {
        setSplitRatio(
          direction === 'row' ? (move.clientX - rect.left) / rect.width : (move.clientY - rect.top) / rect.height,
        )
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [containerRef, direction, setSplitRatio],
  )

  return { onMouseDown }
}
