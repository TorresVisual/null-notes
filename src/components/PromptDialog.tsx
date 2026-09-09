import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { usePromptDialogStore } from '../store/promptDialog'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

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

  return (
    <Dialog open onOpenChange={(next) => !next && cancel()}>
      <DialogContent className="settings-panel prompt-dialog" showCloseButton={false}>
        <form className="prompt-dialog-form" onSubmit={handleSubmit}>
          <DialogTitle asChild>
            <p className="prompt-dialog-message">{message}</p>
          </DialogTitle>
          <input
            ref={inputRef}
            className="prompt-dialog-input"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="prompt-dialog-actions">
            <button type="button" className="import-mode-cancel" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" className="dialog-action-primary" disabled={!value.trim()}>
              OK
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
