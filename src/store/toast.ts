import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (message: string) => void
  dismiss: (id: number) => void
}

// Long enough to read a short confirmation, short enough to stay out of the
// way of the next one — same order of magnitude as the Git commit chip's
// own COMMITTED_DISPLAY_MS (useGitAutoCommit.ts).
export const TOAST_AUTO_DISMISS_MS = 4000

let nextId = 0

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message }] }))
    // Scheduled once, here, at push time — not recomputed in a component
    // effect keyed on the toast list, which would reset every existing
    // toast's remaining time whenever a new one arrives.
    setTimeout(() => get().dismiss(id), TOAST_AUTO_DISMISS_MS)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// Fire-and-forget acknowledgment, callable from anywhere — same shape as
// promptText (store/promptDialog.ts): a plain function wrapping the store
// so call sites don't need to know it's backed by Zustand.
export function showToast(message: string): void {
  useToastStore.getState().push(message)
}
