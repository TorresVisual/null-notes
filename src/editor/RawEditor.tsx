interface RawEditorProps {
  content: string
  onChange: (markdown: string) => void
}

export function RawEditor({ content, onChange }: RawEditorProps) {
  return (
    <textarea
      className="raw-editor"
      value={content}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      aria-label="Raw markdown"
    />
  )
}
