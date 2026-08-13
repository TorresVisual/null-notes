interface RawEditorProps {
  content: string
  spellcheck: boolean
  spellcheckLanguage: string
  onChange: (markdown: string) => void
}

export function RawEditor({ content, spellcheck, spellcheckLanguage, onChange }: RawEditorProps) {
  return (
    <textarea
      className="raw-editor"
      value={content}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={spellcheck}
      lang={spellcheckLanguage}
      aria-label="Raw markdown"
    />
  )
}
