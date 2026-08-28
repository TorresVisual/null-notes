import { create } from 'zustand'
import { confirm } from '@tauri-apps/plugin-dialog'

interface CodeRunConfirmStore {
  confirmedNotes: Set<string>
  confirmNote: (notePath: string) => Promise<boolean>
}

/**
 * Gates the first code-block run per note per app session behind a native
 * confirm dialog (P10-2). In-memory only — nothing here is written to
 * `settings.json`, the note file, or `index.db`, so every fresh session
 * re-asks. This is the feature's whole security model: friction and
 * visibility, not a sandbox. See docs/specs/code-execution-design.md.
 */
export const useCodeRunConfirmStore = create<CodeRunConfirmStore>((set, get) => ({
  confirmedNotes: new Set(),
  confirmNote: async (notePath) => {
    if (get().confirmedNotes.has(notePath)) return true

    const allowed = await confirm(
      'This note contains code. Allow it to run on your machine? ' +
        'It runs with no sandbox — the same trust level as typing it into the terminal.',
    )
    if (allowed) {
      set((state) => ({ confirmedNotes: new Set(state.confirmedNotes).add(notePath) }))
    }
    return allowed
  },
}))
