import type { MathMenuItem } from '../../hooks/useMathSnippetMenu'

interface MathSnippetMenuProps {
  matches: MathMenuItem[]
  selected: number
  onSelect: (item: MathMenuItem) => void
}

export function MathSnippetMenu({ matches, selected, onSelect }: MathSnippetMenuProps) {
  if (!matches.length) return null
  return (
    <div className="math-snippet-menu" contentEditable={false}>
      {matches.map((item, i) => (
        <button
          key={item.key}
          type="button"
          className={`math-snippet-item${i === selected ? ' selected' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(item)
          }}
        >
          <span className="math-snippet-trigger">{item.label}</span>
          <span className="math-snippet-desc">{item.description}</span>
        </button>
      ))}
    </div>
  )
}
