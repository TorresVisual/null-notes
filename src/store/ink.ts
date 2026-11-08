import { create } from 'zustand'
import type { EraserMode, Pen, Tool } from '../ink/types'
import {
  DEFAULT_PENS,
  clampEraserSize,
  clampTextSize,
  loadActivePenId,
  loadEraserMode,
  loadEraserSize,
  loadPens,
  loadTextSize,
  saveActivePenId,
  saveEraserMode,
  saveEraserSize,
  savePens,
  saveTextSize,
  withPen,
} from '../ink/pens'

// What is in your hand, as opposed to what is on the page. A pen is a pen
// wherever you draw, and this state was already shared — `ink/pens.ts` has
// always persisted it to localStorage, so every canvas in the app rendered
// its own copy of one set of values. The store makes that explicit; it does
// not change it. Strokes, history, selection, ruler and zoom stay per-canvas
// in `useInkCanvas`.
/** What the toolbar can do to the canvas being drawn in.
 *
 * Everything here is per-canvas by nature: two canvases have separate
 * histories, separate selections, separate rulers and separate zoom. None of
 * it could live in the store itself without meaning the wrong thing. */
export interface CanvasHandle {
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  deleteSelected: () => void
  hasSelection: boolean
  toggleRuler: () => void
  rulerOn: boolean
  zoom: number
  setZoom: (zoom: number) => void
  cropToContent: () => void
}

interface InkStore {
  tool: Tool
  pens: Pen[]
  activePenId: string
  eraserMode: EraserMode
  eraserSize: number
  textSize: number
  activeCanvas: CanvasHandle | null
  activeCanvasId: string | null
  setTool: (tool: Tool) => void
  selectPen: (id: string) => void
  updateActivePen: (changes: Partial<Pen>) => void
  setEraserMode: (mode: EraserMode) => void
  setEraserSize: (size: number) => void
  setTextSize: (size: number) => void
  setActiveCanvas: (id: string, handle: CanvasHandle) => void
  clearActiveCanvas: (id: string) => void
}

export function activePenOf(state: Pick<InkStore, 'pens' | 'activePenId'>): Pen {
  return state.pens.find((pen) => pen.id === state.activePenId) ?? DEFAULT_PENS[0]
}

export const useInkStore = create<InkStore>((set, get) => ({
  tool: 'pen',
  pens: loadPens(),
  activePenId: loadActivePenId(loadPens()),
  eraserMode: loadEraserMode(),
  eraserSize: loadEraserSize(),
  textSize: loadTextSize(),
  activeCanvas: null,
  activeCanvasId: null,

  setTool: (tool) => set({ tool }),

  // Reaching for a colour means you intend to draw with it.
  selectPen: (id) => {
    saveActivePenId(id)
    set({ activePenId: id, tool: 'pen' })
  },

  updateActivePen: (changes) => {
    const updated = withPen(get().pens, { ...activePenOf(get()), ...changes })
    savePens(updated)
    set({ pens: updated })
  },

  setEraserMode: (mode) => {
    saveEraserMode(mode)
    set({ eraserMode: mode })
  },

  setEraserSize: (size) => {
    const clamped = clampEraserSize(size)
    saveEraserSize(clamped)
    set({ eraserSize: clamped })
  },

  setTextSize: (size) => {
    const clamped = clampTextSize(size)
    saveTextSize(clamped)
    set({ textSize: clamped })
  },

  setActiveCanvas: (id, handle) => set({ activeCanvas: handle, activeCanvasId: id }),
  // Only the current owner's id can clear the slot: a canvas that has
  // already lost it to another one must not be able to wipe out the new
  // owner's registration from its own stale unmount or effect cleanup —
  // that exact bug is why this is keyed on an id rather than a bare toggle.
  clearActiveCanvas: (id) => {
    if (get().activeCanvasId === id) set({ activeCanvas: null, activeCanvasId: null })
  },
}))
