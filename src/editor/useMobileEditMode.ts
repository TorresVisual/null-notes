import { useCallback, useEffect } from 'react'
import type { Editor } from '@tiptap/core'
import { useMobileEditStore } from '../store/mobileEdit'
import { isMobile } from '../lib/platform'
import { discardIfUntouched } from '../hooks/useQuickNote'

export function useMobileEditMode(editor: Editor | null, notePath: string) {
  const editingPath = useMobileEditStore((s) => s.editingPath)
  const readOnly = isMobile() && editingPath !== notePath

  // emitUpdate false: toggling editability is not a content change, and an
  // update event would push the unchanged note through onChange and the save path.
  // Focus lives here as well as in startEditing: a note opened already in edit
  // mode (the + button) never goes through the pencil.
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly, false)
    if (!readOnly && isMobile()) editor.commands.focus()
  }, [editor, readOnly])

  const startEditing = useCallback(() => {
    useMobileEditStore.getState().startEditing(notePath)
    // Editable before focus(): the store update re-renders after this handler,
    // and focusing a still-read-only editor would not raise the keyboard.
    editor?.setEditable(true, false)
    editor?.commands.focus()
  }, [editor, notePath])

  const stopEditing = useCallback(() => {
    useMobileEditStore.getState().stopEditing()
    editor?.commands.blur()
    void discardIfUntouched(notePath)
  }, [editor, notePath])

  return { readOnly, startEditing, stopEditing }
}
