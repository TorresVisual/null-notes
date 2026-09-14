import { create } from 'zustand'

interface MobileSidebarStore {
  open: boolean
  toggle: () => void
  close: () => void
}

/**
 * Session-only drawer-open state for the mobile sidebar (isMobile() gated —
 * see Sidebar.tsx/Titlebar.tsx). A dedicated store, mirroring focusMode.ts,
 * because Sidebar.tsx needs to close itself from deep inside a nav-action
 * handler without Layout.tsx threading the state down as a prop.
 */
export const useMobileSidebarStore = create<MobileSidebarStore>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}))
