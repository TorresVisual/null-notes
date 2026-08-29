import { create } from 'zustand'

interface FocusModeStore {
  enabled: boolean
  toggle: () => void
}

/**
 * Session-only, like `viewMode`/`terminalOpen` — resets to off on restart,
 * never written to settings.json. `Layout.tsx` reads this to hide the
 * sidebar; `FocusMode.ts` (a ProseMirror extension) reads it to dim
 * inactive blocks. A dedicated store because a ProseMirror extension has no
 * other way to reach React component state.
 */
export const useFocusModeStore = create<FocusModeStore>((set) => ({
  enabled: false,
  toggle: () => set((s) => ({ enabled: !s.enabled })),
}))
