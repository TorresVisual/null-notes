import { createContext } from 'react'

export interface CanvasActions {
  locked: boolean
  /** The pass whose group should pulse once because it just arrived. */
  pulsePass: number | null
  workspace: string | null
  /** Safe workspace-relative file paths that resolve to a real file. Anything else renders inert. */
  fileStatus: Record<string, boolean>
  editText: (id: string, text: string) => void
  deletePass: (pass: number) => void
}

export const CanvasActionsContext = createContext<CanvasActions>({
  locked: true,
  pulsePass: null,
  workspace: null,
  fileStatus: {},
  editText: () => {},
  deletePass: () => {},
})
