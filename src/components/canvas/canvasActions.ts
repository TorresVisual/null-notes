import { createContext } from 'react'

export interface CanvasActions {
  locked: boolean
  workspace: string | null
  /** Safe workspace-relative file paths that resolve to a real file. Anything else renders inert. */
  fileStatus: Record<string, boolean>
  editText: (id: string, text: string) => void
  deletePass: (pass: number) => void
}

export const CanvasActionsContext = createContext<CanvasActions>({
  locked: true,
  workspace: null,
  fileStatus: {},
  editText: () => {},
  deletePass: () => {},
})
