import { create } from 'zustand'

interface DirtyPathsStore {
  paths: ReadonlySet<string>
  markDirty: (path: string) => void
  markClean: (path: string) => void
}

export const useDirtyPathsStore = create<DirtyPathsStore>((set) => ({
  paths: new Set(),
  markDirty: (path) =>
    set((state) => (state.paths.has(path) ? state : { paths: new Set(state.paths).add(path) })),
  markClean: (path) =>
    set((state) => {
      if (!state.paths.has(path)) return state
      const paths = new Set(state.paths)
      paths.delete(path)
      return { paths }
    }),
}))
