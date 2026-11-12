import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { api } from '../lib/tauri'
import { spellSuggestions } from '../lib/spellClient'
import { useSettingsStore } from '../store/settings'
import { showToast } from '../store/toast'
import type { SpellMenuTarget } from './extensions/Spellcheck'

interface SpellMenuProps {
  editor: Editor
  target: SpellMenuTarget
  onClose: () => void
}

const MENU_WIDTH = 220

export function SpellMenu({ editor, target, onClose }: SpellMenuProps) {
  const [suggestions, setSuggestions] = useState<string[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void spellSuggestions(target.lang, target.word).then((found) => {
      if (!cancelled) setSuggestions(found)
    })
    return () => {
      cancelled = true
    }
  }, [target])

  useEffect(() => {
    const away = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', away)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', away)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  const replace = (word: string) => {
    const { from, to } = target
    // The note may have changed between the right-click and the choice.
    if (editor.state.doc.textBetween(from, to) === target.word) {
      editor.view.dispatch(editor.state.tr.insertText(word, from, to))
      editor.view.focus()
    }
    onClose()
  }

  const addToDictionary = () => {
    const { settings, setSettings } = useSettingsStore.getState()
    const next = { ...settings, spellcheckWords: [...new Set([...settings.spellcheckWords, target.word.toLowerCase()])] }
    setSettings(next)
    api.settings.save(next).catch(() => showToast("Couldn't save the dictionary"))
    onClose()
  }

  return (
    <div
      ref={ref}
      className="context-menu spell-menu"
      role="menu"
      style={{ position: 'fixed', zIndex: 60, left: Math.min(target.x, window.innerWidth - MENU_WIDTH), top: target.y, width: MENU_WIDTH }}
    >
      {suggestions === null && <span className="spell-menu-note">Looking up…</span>}
      {suggestions?.length === 0 && <span className="spell-menu-note">No suggestions</span>}
      {suggestions?.map((word) => (
        <button key={word} type="button" role="menuitem" onClick={() => replace(word)}>
          {word}
        </button>
      ))}
      <hr />
      <button type="button" role="menuitem" onClick={addToDictionary}>
        Add “{target.word}” to dictionary
      </button>
    </div>
  )
}
