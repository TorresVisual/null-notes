interface BaseSourceProps {
  source: string
  onChange: (text: string) => void
}

export function BaseSource({ source, onChange }: BaseSourceProps) {
  return (
    <textarea
      className="base-source"
      aria-label="Base source"
      spellCheck={false}
      value={source}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
