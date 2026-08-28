import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Excalidraw, exportToSvg } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawImperativeAPI, AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { diagramApi } from '../../lib/diagram'
import { report } from '../splitIntoTasks'

interface DiagramEditorOverlayProps {
  jsonSrc: string
  svgSrc: string
  onClose: (svg: string) => void
}

interface StoredScene {
  elements?: ExcalidrawElement[]
  appState?: Partial<AppState>
  files?: BinaryFiles
}

interface Scene {
  elements: ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

export function DiagramEditorOverlay({ jsonSrc, svgSrc, onClose }: DiagramEditorOverlayProps) {
  const [scene, setScene] = useState<Scene | null>(null)
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)

  useEffect(() => {
    let cancelled = false
    diagramApi
      .read(jsonSrc)
      .then((json) => {
        if (cancelled) return
        const parsed = JSON.parse(json) as StoredScene
        setScene({ elements: parsed.elements ?? [], appState: parsed.appState ?? {}, files: parsed.files ?? {} })
      })
      .catch(() => {
        if (!cancelled) setScene({ elements: [], appState: {}, files: {} })
      })
    return () => {
      cancelled = true
    }
  }, [jsonSrc])

  async function handleClose() {
    if (!api) {
      onClose('')
      return
    }
    const elements = api.getSceneElements()
    const appState = api.getAppState()
    const files = api.getFiles()
    const json = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'null-notes',
      elements,
      appState,
      files,
    })
    const svgEl = await exportToSvg({ elements, appState, files })
    const svg = svgEl.outerHTML
    try {
      await diagramApi.write(jsonSrc, json)
      await diagramApi.write(svgSrc, svg)
    } catch (error) {
      report(error)
    }
    onClose(svg)
  }

  return createPortal(
    <div className="diagram-editor-overlay">
      <div className="diagram-editor-modal">
        <div className="diagram-editor-header">
          <button type="button" className="dialog-action-primary" onClick={() => void handleClose()}>
            Done
          </button>
        </div>
        <div className="diagram-editor-canvas">
          {scene && (
            <Excalidraw
              initialData={{ elements: scene.elements, appState: scene.appState, files: scene.files }}
              excalidrawAPI={(instance) => setApi(instance)}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
