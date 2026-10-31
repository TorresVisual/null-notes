import { create } from 'zustand'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  message: string
  action?: ToastAction
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, action?: ToastAction) => void
  dismiss: (id: number) => void
}

// Long enough to read a short confirmation, short enough to stay out of the
// way of the next one — same order of magnitude as the Git commit chip's
// own COMMITTED_DISPLAY_MS (useGitAutoCommit.ts).
export const TOAST_AUTO_DISMISS_MS = 4000

// A toast with a button needs time to be reached for, not just read.
export const ACTION_TOAST_AUTO_DISMISS_MS = 8000

let nextId = 0

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, action) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message, action }] }))
    // Scheduled once, here, at push time — not recomputed in a component
    // effect keyed on the toast list, which would reset every existing
    // toast's remaining time whenever a new one arrives.
    setTimeout(
      () => get().dismiss(id),
      action ? ACTION_TOAST_AUTO_DISMISS_MS : TOAST_AUTO_DISMISS_MS,
    )
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// Fire-and-forget acknowledgment, callable from anywhere — same shape as
// promptText (store/promptDialog.ts): a plain function wrapping the store
// so call sites don't need to know it's backed by Zustand.
export function showToast(message: string, action?: ToastAction): void {
  useToastStore.getState().push(message, action)
}
