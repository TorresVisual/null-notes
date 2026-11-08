import type { RefObject } from 'react'
import { useSplitDivider } from '../hooks/useSplitDivider'

interface SplitDividerProps {
  direction: 'row' | 'column'
  ratio: number
  containerRef: RefObject<HTMLElement | null>
}

export function SplitDivider({ direction, ratio, containerRef }: SplitDividerProps) {
  const { onMouseDown } = useSplitDivider(containerRef, direction)
  return (
    <div
      className={`split-divider split-divider--${direction}`}
      role="separator"
      aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(ratio * 100)}
      onMouseDown={onMouseDown}
    />
  )
}
