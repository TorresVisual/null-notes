interface RawEditorProps {
  content: string
  spellcheck: boolean
  onChange: (markdown: string) => void
}

export function RawEditor({ content, spellcheck, onChange }: RawEditorProps) {
  return (
    <textarea
      className="raw-editor"
      value={content}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={spellcheck}
      aria-label="Raw markdown"
    />
  )
}
