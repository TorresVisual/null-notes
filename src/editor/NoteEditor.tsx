import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Editor, Range } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { confirm, message } from '@tauri-apps/plugin-dialog'
import { extensionsFor } from './extensions'
import { rememberPosition, recallPosition } from '../lib/notePositions'
import { takePendingHighlight } from '../lib/pendingHighlight'
import { highlightHeading, highlightImage, highlightPdfPage, highlightSearchMatch } from './extensions/SearchJumpHighlight'
import { handleEditorKeyDown, handleEditorTextInput } from './extensions/CodeBlockEditor'
import { splitIntoTasks, report, markdownOf } from './splitIntoTasks'
import { extractSelection } from './extractSelection'
import { useWorkspaceStore } from '../store/workspace'
import { linkMention, LINK_MENTION_EVENT } from './linkMention'
import { EditorStatusBar } from './EditorStatusBar'
import { BlockHandle } from './extensions/BlockHandle'
import { EditorToolbar } from './toolbar/EditorToolbar'
import { useKeepCaretVisible, useKeyboardInset, caretScrollProps } from './useKeepCaretVisible'
import { useMobileEditMode } from './useMobileEditMode'
import { MobileEditToggle } from './MobileEditToggle'
import { isMobile } from '../lib/platform'
import { useInkStore } from '../store/ink'
import { useSettingsStore } from '../store/settings'

interface NoteEditorProps {
  content: string
  notePath: string
  spellcheck: boolean
  spellcheckLanguage: string
  onChange: (markdown: string) => void
  onFlashcardCommand: (editor: Editor, range: Range) => void
  // Optional — tests that don't exercise diagram insertion can omit it;
  // storage is only wired up when a caller (Layout) actually provides one.
  onDiagramCommand?: (editor: Editor, range: Range | null) => void
}

// `lang` is the only thing that tells the WebView which dictionary to check
// against; without it the note inherits index.html's `lang="en"`, and German
// prose comes back underlined word for word.
function buildEditorProps(spellcheck: boolean, language: string) {
  return {
    attributes: { spellcheck: String(spellcheck), lang: language, role: 'textbox', 'aria-label': 'Note', 'aria-multiline': 'true' },
    handleKeyDown: handleEditorKeyDown,
    handleTextInput: handleEditorTextInput,
    ...caretScrollProps(isMobile()),
  }
}

function jumpToPending(editor: Editor, notePath: string) {
  const pending = takePendingHighlight(notePath)
  if (!pending) return
  if (pending.page !== undefined) highlightPdfPage(editor, pending.page)
  else if (pending.image) highlightImage(editor, pending.image)
  else if (pending.heading) highlightHeading(editor, pending.text)
  else highlightSearchMatch(editor, pending.text)
}

export function NoteEditor({
  content,
  notePath,
  spellcheck,
  spellcheckLanguage,
  onChange,
  onFlashcardCommand,
  onDiagramCommand,
}: NoteEditorProps) {
  const isProgrammaticUpdate = useRef(false)
  const [, setEditorVersion] = useState(0)
  const codeTheme = useSettingsStore((s) => s.settings.codeTheme)
  const codeFontSizePx = useSettingsStore((s) => s.settings.codeFontSizePx)
  const proseFontSizePx = useSettingsStore((s) => s.settings.proseFontSizePx)
  const proseLineHeight = useSettingsStore((s) => s.settings.proseLineHeight)
  // Set alongside every onChange, so the content-sync effect below can tell
  // "this update came back from our own typing" from "content changed out
  // from under us" with a === check instead of re-serializing the whole
  // document a second time on every keystroke.
  const lastEmitted = useRef<string | null>(null)

  const editor = useEditor({
    extensions: extensionsFor(notePath),
    content,
    editorProps: buildEditorProps(spellcheck, spellcheckLanguage),
    onUpdate({ editor }) {
      if (isProgrammaticUpdate.current) return
      const markdown = markdownOf(editor)
      lastEmitted.current = markdown
      onChange(markdown)
    },
  })

  useKeepCaretVisible(editor)
  useKeyboardInset()
  const { readOnly, startEditing, stopEditing } = useMobileEditMode(editor, notePath)

  // ProseMirror re-applies editorProps.attributes to the DOM on every state
  // update, so setting the attribute by hand would be undone on the next
  // keystroke — the option itself has to change. setOptions rather than
  // useEditor deps, which would rebuild the editor and drop the cursor.
  useEffect(() => {
    editor?.setOptions({ editorProps: buildEditorProps(spellcheck, spellcheckLanguage) })
  }, [editor, spellcheck, spellcheckLanguage])

  useEffect(() => {
    if (!editor) return
    if (content === lastEmitted.current) return
    const current = markdownOf(editor)
    if (content !== current) {
      isProgrammaticUpdate.current = true
      // A node view mounted by this setContent (e.g. a wiki-link) makes
      // tiptap's ReactRenderer flushSync, which React rejects from inside
      // this effect's own commit (#14). isEditorContentInitialized is what
      // ReactRenderer checks to decide flushSync vs. a queued microtask
      // render — toggling it off for the call routes new node views through
      // the async path instead, with no change to when `content` lands.
      const withInitFlag = editor as unknown as { isEditorContentInitialized?: boolean }
      const wasInitialized = withInitFlag.isEditorContentInitialized
      withInitFlag.isEditorContentInitialized = false
      editor.storage.noteContext.notePath = notePath
      // Text that arrives from another view of the note must not move this
      // view's caret or land in its undo history, or Ctrl+Z here would undo
      // typing done in the other group.
      const { anchor, head } = editor.state.selection
      const fromPeer = !editor.isFocused
      editor.chain().setMeta('addToHistory', !fromPeer).setContent(content).run()
      const size = editor.state.doc.content.size
      editor.commands.setTextSelection({ from: Math.min(anchor, size), to: Math.min(head, size) })
      withInitFlag.isEditorContentInitialized = wasInitialized
      isProgrammaticUpdate.current = false
    }
  }, [content, editor, notePath])

  useEffect(() => {
    if (!editor) return
    editor.storage.noteContext.notePath = notePath
    editor.storage.noteContext.openFlashcardDialog = onFlashcardCommand
    editor.storage.noteContext.openDiagramDialog = onDiagramCommand ?? null
  }, [editor, notePath, onFlashcardCommand, onDiagramCommand])

  // Recording on selectionUpdate rather than on unmount: the editor is already
  // destroyed by the time an unmount cleanup could read its state.
  useEffect(() => {
    if (!editor) return
    const onSelectionUpdate = () => {
      setEditorVersion((version) => version + 1)
      const size = editor.state.doc.content.size
      rememberPosition(notePath, {
        cursorFraction: size > 0 ? editor.state.selection.anchor / size : 0,
      })
      // A canvas pointerdown does not move the ProseMirror selection, and the bar
      // preventDefaults its own presses, so this fires only when the caret really
      // lands in prose — which is exactly when the drawing tools should go away.
      // Forced rather than routed through `clearActiveCanvas(id)`: the caret does
      // not know or care which canvas currently owns the slot, only that none
      // should once it has landed in text.
      useInkStore.setState({ activeCanvas: null, activeCanvasId: null })
    }
    editor.on('selectionUpdate', onSelectionUpdate)

    return () => {
      editor.off('selectionUpdate', onSelectionUpdate)
    }
  }, [editor, notePath])

  // Runs once per note. The remembered offset came from a document that may
  // since have changed on disk, so TextSelection.near resolves to the closest
  // valid place instead of throwing on a position that is no longer a
  // text position.
  const restoredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!editor || restoredFor.current === notePath) return
    restoredFor.current = notePath
    const remembered = recallPosition(notePath)
    if (!remembered) return

    editor.commands.command(({ tr, dispatch }) => {
      const position = Math.round(remembered.cursorFraction * tr.doc.content.size)
      dispatch?.(tr.setSelection(TextSelection.near(tr.doc.resolve(position))))
      return true
    })
    // scrollIntoView off: focus() otherwise scrolls the cursor into view from
    // inside a rAF, landing after the scroll restore and overriding it. When
    // the two disagree, what the user was looking at wins over where the
    // cursor happened to be.
    editor.commands.focus(null, { scrollIntoView: false })
  }, [editor, notePath, content])

  // A Ctrl+K search result jump (SearchModal's open()) leaves its target
  // text in pendingHighlight.ts rather than calling into this note
  // directly, since the note may not be mounted yet. This effect covers
  // "just switched to this note"; the window-event listener below covers
  // "this note was already the active tab", which changes neither notePath
  // nor content, so this effect's deps would never re-fire for it.
  useEffect(() => {
    if (!editor) return
    jumpToPending(editor, notePath)
  }, [editor, notePath, content])

  useEffect(() => {
    if (!editor) return
    const onSearchJump = () => jumpToPending(editor, notePath)
    window.addEventListener('search:jump', onSearchJump)
    return () => window.removeEventListener('search:jump', onSearchJump)
  }, [editor, notePath])

  // Same shape, for "Split Into Tasks". Confirmed before it runs: this
  // rewrites the whole note, and asserting that a document *is* an exercise
  // sheet is a claim only the reader can make — which is why no import path
  // does it automatically.
  useEffect(() => {
    async function onSplitTasks() {
      if (!editor || !editor.isFocused) return
      if (!(await confirm('Rewrite this note into Task / Solution sections, each with a handwriting canvas?'))) return
      try {
        if ((await splitIntoTasks(editor)) === 'no-structure') {
          await message('No exercise structure found in this note — nothing was changed.')
          return
        }
        onChange(markdownOf(editor))
      } catch (error) {
        report(error)
      }
    }
    // Named, so the removal targets the same function the addition registered.
    const handler = () => void onSplitTasks()
    window.addEventListener('command:split-tasks', handler)
    return () => window.removeEventListener('command:split-tasks', handler)
  }, [editor, onChange])

  // Only on this explicit command, never on save: a hand-edited or synced note
  // is not rewritten until the user asks. The editor's own serializer is the
  // canonical shape, and onChange carries it down the normal save path.
  useEffect(() => {
    const handler = () => {
      if (!editor || !editor.isFocused) return
      const markdown = markdownOf(editor)
      lastEmitted.current = markdown
      onChange(markdown)
    }
    window.addEventListener('command:format-note', handler)
    return () => window.removeEventListener('command:format-note', handler)
  }, [editor, onChange])

  useEffect(() => {
    const handler = () => {
      const workspace = useWorkspaceStore.getState().path
      if (!editor || !editor.isFocused || !workspace) return
      extractSelection(editor, notePath, workspace).catch(report)
    }
    window.addEventListener('command:extract-selection', handler)
    return () => window.removeEventListener('command:extract-selection', handler)
  }, [editor, notePath])

  useEffect(() => {
    if (!editor) return
    const foldAll = () => editor.isFocused && editor.commands.foldAll()
    const unfoldAll = () => editor.isFocused && editor.commands.unfoldAll()
    window.addEventListener('command:fold-all', foldAll)
    window.addEventListener('command:unfold-all', unfoldAll)
    return () => {
      window.removeEventListener('command:fold-all', foldAll)
      window.removeEventListener('command:unfold-all', unfoldAll)
    }
  }, [editor])

  // The outgoing-links panel's "link this mention" action. The note path in
  // the event keeps a second pane showing a different note from reacting.
  useEffect(() => {
    if (!editor) return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ notePath: string; title: string }>).detail
      if (detail.notePath === notePath) linkMention(editor, detail.title)
    }
    window.addEventListener(LINK_MENTION_EVENT, handler)
    return () => window.removeEventListener(LINK_MENTION_EVENT, handler)
  }, [editor, notePath])

  return (
    <div className="note-editor-wrap">
      {!readOnly && <EditorToolbar editor={editor} notePath={notePath} />}
      <EditorContent
        editor={editor}
        className="note-editor"
        data-code-theme={codeTheme}
        style={
          {
            '--code-font-size': `${codeFontSizePx}px`,
            '--prose-font-size': `${proseFontSizePx}px`,
            '--prose-line-height': proseLineHeight,
          } as CSSProperties
        }
      />
      {isMobile() && <MobileEditToggle readOnly={readOnly} onEdit={startEditing} onDone={stopEditing} />}
      {editor && <BlockHandle editor={editor} />}
      {editor && <EditorStatusBar editor={editor} />}
    </div>
  )
}
