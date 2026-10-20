interface PenSampleProps {
  color: string
  size: number
  opacity: number
  large?: boolean
}

// Width is compressed, not mapped 1:1: a 20px highlighter would swallow its
// card and a 1.5px pencil would vanish. non-scaling-stroke keeps the px width
// the same whether the sample is card-sized or flyout-sized.
export function PenSample({ color, size, opacity, large = false }: PenSampleProps) {
  return (
    <svg className={`ink-pen-sample${large ? ' large' : ''}`} viewBox="0 0 48 20" aria-hidden>
      <path
        d="M4 14C14 0 22 20 32 8S42 6 44 6"
        fill="none"
        stroke={color}
        strokeOpacity={opacity}
        strokeWidth={Math.min(12, 1.5 + size * 0.5)}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
