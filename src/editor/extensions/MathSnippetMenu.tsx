import type { MathSnippet } from '../../lib/mathSnippets'

interface MathSnippetMenuProps {
  matches: MathSnippet[]
  selected: number
  onSelect: (snippet: MathSnippet) => void
}

export function MathSnippetMenu({ matches, selected, onSelect }: MathSnippetMenuProps) {
  if (!matches.length) return null
  return (
    <div className="math-snippet-menu" contentEditable={false}>
      {matches.map((s, i) => (
        <button
          key={s.trigger}
          type="button"
          className={`math-snippet-item${i === selected ? ' selected' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(s)
          }}
        >
          <span className="math-snippet-trigger">/{s.trigger}</span>
          <span className="math-snippet-desc">{s.description}</span>
        </button>
      ))}
    </div>
  )
}
