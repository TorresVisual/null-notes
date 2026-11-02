import { useState } from 'react'

interface FigureNumberInputProps {
  number: string | null
  onCommit: (number: string | null) => void
}

// Same shape a prose reference accepts (see lib/crossRefs.ts), and the only
// shape that is safe to write into a JSON field and an HTML attribute.
const FIGURE_NUMBER = /^\d+(?:\.\d+)*$/

export function FigureNumberInput({ number, onCommit }: FigureNumberInputProps) {
  const [draft, setDraft] = useState(number ?? '')

  function commit() {
    const next = draft.trim()
    if (next && !FIGURE_NUMBER.test(next)) {
      setDraft(number ?? '')
      return
    }
    onCommit(next || null)
  }

  return (
    <label
      className={`figure-number${number ? ' has-value' : ''}`}
      contentEditable={false}
      title="Figure number (optional) — makes it resolvable as Figure N"
    >
      Fig.
      <input
        type="text"
        className="figure-number-input"
        value={draft}
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
    </label>
  )
}
