import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { usePromptDialogStore } from '../store/promptDialog'

// The in-app replacement for window.prompt (see promptText) — a native
// browser prompt looks completely out of place next to the rest of this
// app's chrome, and blocks the render thread while it's up.
export function PromptDialog() {
  const open = usePromptDialogStore((s) => s.open)
  const message = usePromptDialogStore((s) => s.message)
  const defaultValue = usePromptDialogStore((s) => s.defaultValue)
  const submit = usePromptDialogStore((s) => s.submit)
  const cancel = usePromptDialogStore((s) => s.cancel)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setValue(defaultValue)
    // Runs after the value above commits, so select() has the pre-filled
    // text to select rather than racing the input's own re-render.
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [open, defaultValue])

  if (!open) return null

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    submit(trimmed)
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancel()
  }

  return (
    <div className="search-overlay" onMouseDown={cancel}>
      <form
        className="settings-panel prompt-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <p className="prompt-dialog-message">{message}</p>
        <input
          ref={inputRef}
          className="settings-text settings-text-wide prompt-dialog-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="prompt-dialog-actions">
          <button type="button" className="import-mode-cancel" onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className="dialog-action" disabled={!value.trim()}>
            OK
          </button>
        </div>
      </form>
    </div>
  )
}
