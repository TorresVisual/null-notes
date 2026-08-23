import { create } from 'zustand'

interface PromptDialogState {
  open: boolean
  message: string
  defaultValue: string
  resolve: ((value: string | null) => void) | null
  request: (message: string, defaultValue?: string) => Promise<string | null>
  submit: (value: string) => void
  cancel: () => void
}

/**
 * Backs `promptText`, the in-app replacement for `window.prompt` — a single
 * pending request at a time, resolved by whichever of submit/cancel the
 * rendered `PromptDialog` calls. A prompt in flight when a new one is
 * requested is cancelled first: dialogs are modal, so this shouldn't happen
 * in practice, but no caller's promise is left unsettled if it does.
 */
export const usePromptDialogStore = create<PromptDialogState>((set, get) => ({
  open: false,
  message: '',
  defaultValue: '',
  resolve: null,
  request: (message, defaultValue = '') =>
    new Promise<string | null>((resolve) => {
      get().resolve?.(null)
      set({ open: true, message, defaultValue, resolve })
    }),
  submit: (value) => {
    get().resolve?.(value)
    set({ open: false, resolve: null })
  },
  cancel: () => {
    get().resolve?.(null)
    set({ open: false, resolve: null })
  },
}))

// window.prompt's own call shape (message, defaultValue) — kept the same so
// swapping a call site is a one-word change.
export function promptText(message: string, defaultValue = ''): Promise<string | null> {
  return usePromptDialogStore.getState().request(message, defaultValue)
}
