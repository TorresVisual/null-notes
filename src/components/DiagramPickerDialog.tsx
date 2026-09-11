import { useState } from 'react'
import { X } from 'lucide-react'
import type { Editor, Range } from '@tiptap/core'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { diagramApi } from '../lib/diagram'
import { insertDiagram, DIAGRAM_WIDTH, DIAGRAM_HEIGHT } from '../editor/toolbar/insertDiagram'
import { report } from '../editor/splitIntoTasks'
import type { DiagramMetadata } from '../types'

interface DiagramPickerDialogProps {
  editor: Editor
  range: Range | null
  // Fetched once by the caller (Layout) before opening — Layout also uses
  // an empty list to skip this dialog entirely, so it always has the list
  // in hand already; fetching a second time here would just race it.
  diagrams: DiagramMetadata[]
  onClose: () => void
}

function fileStem(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.excalidraw$/, '')
}

// Only entry point for /diagram and the toolbar's insert-diagram button —
// both hand off here rather than calling insertDiagram directly, so "reuse
// existing" (#39) has one place to seed a fresh block from, whatever the
// user ends up picking.
export function DiagramPickerDialog({ editor, range, diagrams, onClose }: DiagramPickerDialogProps) {
  const [picked, setPicked] = useState<DiagramMetadata | null>(null)

  function insertBlock(jsonSrc: string, svgSrc: string) {
    const chain = editor.chain().focus()
    if (range) chain.deleteRange(range)
    chain.insertContent({
      type: 'diagramBlock',
      attrs: { jsonSrc, svgSrc, width: DIAGRAM_WIDTH, height: DIAGRAM_HEIGHT },
    }).run()
  }

  function handleNew() {
    const notePath = editor.storage.noteContext.notePath
    if (range) editor.chain().focus().deleteRange(range).run()
    void insertDiagram(editor, notePath).then(onClose).catch(report)
  }

  function handleReuse(diagram: DiagramMetadata) {
    insertBlock(diagram.jsonPath, diagram.svgPath)
    onClose()
  }

  async function handleDuplicate(diagram: DiagramMetadata) {
    const notePath = editor.storage.noteContext.notePath
    const dir = await diagramApi.ensureDir(notePath)
    const sep = dir.includes('\\') ? '\\' : '/'
    const id = Date.now()
    const jsonSrc = `${dir}${sep}diagram-${id}.excalidraw`
    const svgSrc = `${dir}${sep}diagram-${id}.svg`
    const [json, svg] = await Promise.all([diagramApi.read(diagram.jsonPath), diagramApi.read(diagram.svgPath)])
    await Promise.all([diagramApi.write(jsonSrc, json), diagramApi.write(svgSrc, svg)])
    insertBlock(jsonSrc, svgSrc)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="settings-panel" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>{picked ? fileStem(picked.jsonPath) : 'Insert Diagram'}</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </div>

        {!picked ? (
          <div className="template-list">
            <button className="import-mode-option" onClick={handleNew}>
              <span>
                <strong>New diagram</strong>
                <small>Starts from an empty scene</small>
              </span>
            </button>
            {diagrams.map((d) => (
              <button key={d.jsonPath} className="import-mode-option" onClick={() => setPicked(d)}>
                <span>
                  <strong>{d.noteTitle}</strong>
                  <small>{fileStem(d.jsonPath)}</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="template-empty-hint">From &quot;{picked.noteTitle}&quot;.</p>
            <div className="template-list">
              <button className="import-mode-option" onClick={() => handleReuse(picked)}>
                <span>
                  <strong>Reuse</strong>
                  <small>Same file — editing it here changes it everywhere it&apos;s used</small>
                </span>
              </button>
              <button className="import-mode-option" onClick={() => void handleDuplicate(picked).catch(report)}>
                <span>
                  <strong>Duplicate into this note</strong>
                  <small>Independent copy — editing it here never affects the original</small>
                </span>
              </button>
            </div>
            <div className="template-dialog-actions">
              <button className="import-mode-cancel" onClick={() => setPicked(null)}>
                Back
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
