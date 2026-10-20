import type { Tool } from './types'

const TOOL_KEYS: Record<string, Tool> = { p: 'pen', e: 'eraser', l: 'lasso', t: 'text' }

const TEXT_ENTRY = 'input, textarea, [contenteditable]:not([contenteditable="false"])'

interface ShortcutEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  defaultPrevented: boolean
  target: EventTarget | null
}

// Plain letters must never win over text entry: the canvas text tool, a flyout
// slider and the note behind all take letters as input.
export function toolForShortcut(e: ShortcutEvent): Tool | null {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return null
  if (e.target instanceof Element && e.target.closest(TEXT_ENTRY)) return null
  return TOOL_KEYS[e.key.toLowerCase()] ?? null
}
