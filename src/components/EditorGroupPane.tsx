import { lazy, Suspense, useEffect, useRef, type RefObject } from 'react'
import type { Editor, Range } from '@tiptap/core'
import { useWorkspaceStore } from '../store/workspace'
import { useNote } from '../hooks/useNote'
import { useScrollRestoration } from '../hooks/useScrollRestoration'
import { useTabDrop } from '../hooks/useTabDrop'
import { isBasePath, isCanvasPath } from '../lib/canvasPath'
import { EditorPane, type EditorPaneProps } from './EditorPane'
import { ErrorBoundary } from './ErrorBoundary'
import { OutlinePanel } from './OutlinePanel'
import { OutgoingLinksPanel } from './OutgoingLinksPanel'
import { TabBar, type TabBarStatus } from './TabBar'

const BasePane = lazy(() => import('./BasePane').then((m) => ({ default: m.BasePane })))
const CanvasPane = lazy(() => import('./CanvasPane').then((m) => ({ default: m.CanvasPane })))

export interface GroupSharedProps {
  status: TabBarStatus
  // Points at the focused group's rendered note, which export and print read.
  exportPaneRef: RefObject<HTMLDivElement | null>
  outlineOpen: boolean
  outgoingLinksOpen: boolean
  onFlashcardCommand: (editor: Editor, range: Range) => void
  onDiagramCommand: (editor: Editor, range: Range | null) => void
  emptyState: EditorPaneProps['emptyState']
}

interface EditorGroupPaneProps {
  group: number
  shared: GroupSharedProps
  // The phone shell has one editor and no tab bar or side panels.
  bare?: boolean
}

export function EditorGroupPane({ group, shared, bare = false }: EditorGroupPaneProps) {
  const active = useWorkspaceStore((s) => s.layout.groups[group]?.active ?? null)
  const viewMode = useWorkspaceStore((s) => s.layout.groups[group]?.viewMode ?? 'wysiwyg')
  const focused = useWorkspaceStore((s) => s.layout.focused === group)
  const multiple = useWorkspaceStore((s) => s.layout.groups.length > 1)
  const share = useWorkspaceStore((s) => (group === 0 ? s.layout.ratio : 1 - s.layout.ratio))
  const focusGroup = useWorkspaceStore((s) => s.focusGroup)

  const fileTab = active !== null && (isCanvasPath(active) || isBasePath(active))
  const note = useNote(fileTab ? null : active)
  const paneRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { zone, dropProps } = useTabDrop(group, bodyRef)
  const scrollRef = useScrollRestoration(active, note.isLoading, viewMode)

  useEffect(() => {
    if (focused) shared.exportPaneRef.current = paneRef.current
  })

  const showPanels = !bare && !fileTab && !note.isLoading && active !== null && viewMode === 'wysiwyg'

  return (
    <div
      className={`editor-group${multiple && focused ? ' editor-group--focused' : ''}`}
      style={multiple ? { flex: `${share} 1 0%` } : undefined}
      onMouseDownCapture={() => !focused && focusGroup(group)}
      onFocusCapture={() => !focused && focusGroup(group)}
      {...(bare ? {} : dropProps)}
    >
      {!bare && <TabBar group={group} status={group === 0 ? shared.status : undefined} />}
      <div className="editor-body" ref={bodyRef}>
        {zone && <div className={`split-drop-zone split-drop-zone--${zone}`} />}
        <div className="pane-wrapper">
          {fileTab && active ? (
            <ErrorBoundary key={active}>
              <Suspense fallback={null}>
                {isBasePath(active) ? <BasePane path={active} /> : <CanvasPane path={active} />}
              </Suspense>
            </ErrorBoundary>
          ) : (
            <EditorPane
              ref={paneRef}
              scrollRef={scrollRef}
              notePath={active}
              content={note.content}
              isLoading={note.isLoading}
              saveState={note.saveState}
              saveError={note.saveError}
              onSave={note.save}
              onRetrySave={note.retrySave}
              onDismissSaveError={note.dismissError}
              conflict={note.conflict}
              onKeepMine={note.keepMine}
              onReloadTheirs={note.reloadTheirs}
              viewMode={viewMode}
              onFlashcardCommand={shared.onFlashcardCommand}
              onDiagramCommand={shared.onDiagramCommand}
              acceptsCommands={focused}
              emptyState={group === 0 ? shared.emptyState : undefined}
            />
          )}
          {showPanels && shared.outlineOpen && (
            <OutlinePanel content={note.content} containerRef={paneRef} notePath={active} />
          )}
          {showPanels && shared.outgoingLinksOpen && active && (
            <OutgoingLinksPanel content={note.content} notePath={active} />
          )}
        </div>
      </div>
    </div>
  )
}
