import { forwardRef } from 'react'
import type { CSSProperties } from 'react'
import type { Editor, Range } from '@tiptap/core'
import { X } from 'lucide-react'
import { NoteEditor } from '../editor/NoteEditor'
import { RawEditor } from '../editor/RawEditor'
import { BacklinksPanel } from './BacklinksPanel'
import { NoteHistoryPanel } from './NoteHistoryPanel'
import { ConflictBar } from './ConflictBar'
import { PropertiesBlock } from './PropertiesBlock'
import { LoadingStatus } from './LoadingStatus'
import { WorkspacePicker } from './WorkspacePicker'
import { HomeView } from './HomeView'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { useSettingsStore } from '../store/settings'
import { joinFrontmatter, splitFrontmatter } from '../lib/frontmatter'
import type { SaveState } from '../hooks/useNote'

export interface EditorPaneProps {
  notePath: string | null
  content: string
  isLoading: boolean
  saveState: SaveState
  saveError: string | null
  onSave: (markdown: string) => void
  onRetrySave: () => void
  onDismissSaveError: () => void
  conflict: boolean
  onKeepMine: () => void
  onReloadTheirs: () => void
  viewMode: 'wysiwyg' | 'raw'
  onViewModeChange: (mode: 'wysiwyg' | 'raw') => void
  onFlashcardCommand: (editor: Editor, range: Range) => void
  onDiagramCommand?: (editor: Editor, range: Range | null) => void
  // Present only for the secondary pane — its header (view toggle + close)
  // only renders when there's somewhere for "close" to collapse back to.
  onClose?: () => void
  // Only the primary pane shows the pre-workspace picker / empty-workspace
  // state / home dashboard — a second pane is never opened without a note.
  // Grouped into one object (rather than four optional callbacks) so using
  // them never needs a non-null assertion: narrowing on `emptyState &&`
  // proves every field inside it is defined, where four independent
  // optionals would not.
  emptyState?: {
    onOpenTaskView: () => void
    onOpenReview: () => void
    onOpenDeckView: () => void
    onOpenSettings: () => void
    overlayOpen: boolean
  }
  scrollRef?: React.RefObject<HTMLDivElement | null>
}

export const EditorPane = forwardRef<HTMLDivElement, EditorPaneProps>(function EditorPane(
  {
    notePath,
    content,
    isLoading,
    saveState,
    saveError: _saveError,
    onSave,
    onRetrySave: _onRetrySave,
    onDismissSaveError: _onDismissSaveError,
    conflict,
    onKeepMine,
    onReloadTheirs,
    viewMode,
    onViewModeChange,
    onFlashcardCommand,
    onDiagramCommand,
    onClose,
    emptyState,
    scrollRef,
  },
  ref,
) {
  const settings = useSettingsStore((s) => s.settings)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const repoMode = useWorkspaceStore((s) => s.repoMode)
  const notes = useNotesStore((s) => s.notes)
  const currentNote = notes.find((n) => n.path === notePath)
  // The WYSIWYG editor only ever sees the body; the YAML block is re-attached
  // on every change so it reaches disk untouched. Raw view edits the whole file.
  const { frontmatter, body } = splitFrontmatter(content)

  return (
    <div className="editor-scroll" ref={scrollRef}>
      {conflict && <ConflictBar onKeepMine={onKeepMine} onReloadTheirs={onReloadTheirs} />}
      {onClose && (
        <div className="editor-pane-header">
          <button
            className={`view-toggle${viewMode === 'raw' ? ' active' : ''}`}
            onClick={() => onViewModeChange(viewMode === 'wysiwyg' ? 'raw' : 'wysiwyg')}
            title={viewMode === 'wysiwyg' ? 'View source' : 'View preview'}
          >
            {viewMode === 'wysiwyg' ? 'Source' : 'Preview'}
          </button>
          <button className="pane-close" onClick={onClose} aria-label="Close split pane">
            <X size={12} />
          </button>
        </div>
      )}
      <div
        ref={ref}
        className={`editor-pane${!notePath && !workspacePath ? ' editor-pane--center' : ''}`}
        style={{ '--editor-max-width': `${settings.editorMaxWidthPx}px` } as CSSProperties}
      >
        {isLoading && <LoadingStatus />}
        {!isLoading && notePath && viewMode === 'wysiwyg' && (
          <>
            <PropertiesBlock content={content} onSave={onSave} />
            <NoteEditor
              content={body}
              notePath={notePath}
              spellcheck={settings.spellcheck}
              spellcheckLanguage={settings.spellcheckLanguage}
              onChange={(markdown) => onSave(joinFrontmatter(frontmatter, markdown))}
              onFlashcardCommand={onFlashcardCommand}
              onDiagramCommand={onDiagramCommand}
            />
          </>
        )}
        {!isLoading && notePath && viewMode === 'raw' && (
          <RawEditor
            content={content}
            notePath={notePath}
            spellcheck={settings.spellcheck}
            spellcheckLanguage={settings.spellcheckLanguage}
            onChange={onSave}
          />
        )}
        {emptyState && !notePath && !workspacePath && <WorkspacePicker />}
        {emptyState && !notePath && workspacePath && notes.length === 0 && (
          <p className="empty-state">
            Press Ctrl N to create your first note, or press ? for shortcuts
          </p>
        )}
        {emptyState && !notePath && workspacePath && notes.length > 0 && (
          <HomeView
            onOpenTaskView={emptyState.onOpenTaskView}
            onOpenReview={emptyState.onOpenReview}
            onOpenDeckView={emptyState.onOpenDeckView}
            onOpenSettings={emptyState.onOpenSettings}
            overlayOpen={emptyState.overlayOpen}
          />
        )}
        {!isLoading && notePath && currentNote && (
          <BacklinksPanel notePath={notePath} noteTitle={currentNote.title} />
        )}
        {!isLoading && notePath && repoMode && (
          <NoteHistoryPanel
            notePath={notePath}
            saveState={saveState}
            currentContent={content}
            onRestore={onSave}
          />
        )}
      </div>
    </div>
  )
})
