import { create } from 'zustand'

/** What the toolbar's symbol palette can do to whichever math node is
 *  currently being edited — mirrors `ink.ts`'s `CanvasHandle` shape for the
 *  same reason: the toolbar lives outside the node view, so this is the only
 *  path back into that node view's own local (draft, cursor) state. */
export interface MathEditorHandle {
  insertSymbol: (latex: string) => void
  /** Lets the toolbar close the editor when focus leaves both the field and
   *  the palette without landing back in either — see `mathEditorFocus.ts`. */
  commitAndClose: () => void
}

interface MathEditorStore {
  activeEditor: MathEditorHandle | null
  activeEditorId: string | null
  setActiveEditor: (id: string, handle: MathEditorHandle) => void
  clearActiveEditor: (id: string) => void
}

export const useMathEditorStore = create<MathEditorStore>((set, get) => ({
  activeEditor: null,
  activeEditorId: null,

  setActiveEditor: (id, handle) => set({ activeEditor: handle, activeEditorId: id }),
  // Only the current owner's id can clear the slot — same reasoning as
  // `ink.ts`'s `clearActiveCanvas`: a node view that has already lost the
  // slot to another one (or that is unmounting after already being
  // superseded) must not be able to wipe out the new owner's registration.
  clearActiveEditor: (id) => {
    if (get().activeEditorId === id) set({ activeEditor: null, activeEditorId: null })
  },
}))
