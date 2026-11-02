interface ViewModeToggleProps {
  viewMode: 'wysiwyg' | 'raw'
  onToggle: () => void
}

export function ViewModeToggle({ viewMode, onToggle }: ViewModeToggleProps) {
  const raw = viewMode === 'raw'
  return (
    <button
      className="view-toggle"
      onClick={onToggle}
      aria-pressed={raw}
      title={raw ? 'Switch to preview' : 'Switch to the Markdown source'}
    >
      <span className={raw ? undefined : 'is-current'}>Preview</span>
      <span className={raw ? 'is-current' : undefined}>Source</span>
    </button>
  )
}
