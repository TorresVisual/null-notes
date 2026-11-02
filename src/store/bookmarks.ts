import { create } from 'zustand'
import { api } from '../lib/tauri'
import {
  moveBookmark,
  parseBookmarks,
  rewriteBookmarkPrefix,
  sameBookmark,
  serializeBookmarks,
  type Bookmark,
} from '../lib/bookmarks'
import { showToast } from './toast'
import { useWorkspaceStore } from './workspace'

interface BookmarksStore {
  items: Bookmark[]
  workspace: string | null
  // The text last read from or written to disk. The watcher reports our own
  // writes back, so a reload only applies when the file differs from this.
  lastText: string
  load: (workspace: string) => Promise<void>
  reload: () => Promise<void>
  toggle: (bookmark: Bookmark) => void
  remove: (index: number) => void
  setGroup: (index: number, group: string | undefined) => void
  move: (from: number, before: number, group: string | undefined) => void
  rewritePrefix: (oldPrefix: string, newPrefix: string) => void
}

export const useBookmarksStore = create<BookmarksStore>((set, get) => {
  function commit(items: Bookmark[]) {
    const { workspace } = get()
    if (!workspace || items === get().items) return
    const text = serializeBookmarks(items, workspace)
    set({ items, lastText: text })
    api.bookmarks
      .write(workspace, text)
      .then(() => {
        // A bare file edit is invisible to git's pending list, which is scoped
        // to paths the app touched.
        const sep = workspace.includes('\\') ? '\\' : '/'
        useWorkspaceStore.getState().addGitPendingPath(`${workspace}${sep}.bookmarks`)
      })
      .catch(() => showToast("Couldn't save bookmarks"))
  }

  async function read() {
    const { workspace } = get()
    if (!workspace) return
    const text = await api.bookmarks.read(workspace)
    if (get().workspace !== workspace || text === get().lastText) return
    set({ items: parseBookmarks(text, workspace), lastText: text })
  }

  return {
    items: [],
    workspace: null,
    lastText: '',
    load: async (workspace) => {
      set({ workspace, items: [], lastText: '' })
      await read().catch(() => undefined)
    },
    reload: () => read().catch(() => undefined),
    toggle: (bookmark) => {
      const { items } = get()
      const at = items.findIndex((b) => sameBookmark(b, bookmark))
      commit(at >= 0 ? items.filter((_, i) => i !== at) : [...items, bookmark])
    },
    remove: (index) => commit(get().items.filter((_, i) => i !== index)),
    setGroup: (index, group) =>
      commit(get().items.map((b, i) => (i === index ? { ...b, group } : b))),
    move: (from, before, group) => commit(moveBookmark(get().items, from, before, group)),
    rewritePrefix: (oldPrefix, newPrefix) =>
      commit(rewriteBookmarkPrefix(get().items, oldPrefix, newPrefix)),
  }
})
