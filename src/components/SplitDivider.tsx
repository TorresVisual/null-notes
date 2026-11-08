import type { KeyboardEvent, RefObject } from 'react'
import { useSplitDivider } from '../hooks/useSplitDivider'
import { useWorkspaceStore } from '../store/workspace'
import { MAX_RATIO, MIN_RATIO } from '../lib/editorGroups'

const KEY_STEP = 0.05

interface SplitDividerProps {
  direction: 'row' | 'column'
  ratio: number
  containerRef: RefObject<HTMLElement | null>
}

export function SplitDivider({ direction, ratio, containerRef }: SplitDividerProps) {
  const { onMouseDown } = useSplitDivider(containerRef, direction)
  const setSplitRatio = useWorkspaceStore((s) => s.setSplitRatio)
  const resetSplitRatio = useWorkspaceStore((s) => s.resetSplitRatio)
  const [shrink, grow] = direction === 'row' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']

  const onKeyDown = (e: KeyboardEvent) => {
    const next =
      e.key === shrink ? ratio - KEY_STEP
      : e.key === grow ? ratio + KEY_STEP
      : e.key === 'Home' ? MIN_RATIO
      : e.key === 'End' ? MAX_RATIO
      : null
    if (next === null) return
    e.preventDefault()
    setSplitRatio(next)
  }

  return (
    <div
      className={`split-divider split-divider--${direction}`}
      role="separator"
      tabIndex={0}
      aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={MIN_RATIO * 100}
      aria-valuemax={MAX_RATIO * 100}
      onMouseDown={onMouseDown}
      onDoubleClick={resetSplitRatio}
      onKeyDown={onKeyDown}
    />
  )
}
