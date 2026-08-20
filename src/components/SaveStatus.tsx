import { AlertTriangle, Check, Circle, RotateCw, X } from 'lucide-react'
import type { SaveState } from '../hooks/useNote'

interface SaveStatusProps {
  state: SaveState
  error: string | null
  onRetry: () => void
  onDismiss: () => void
}

const LABEL: Record<SaveState, string> = {
  clean: 'Saved',
  dirty: 'Unsaved',
  saving: 'Saving…',
  error: 'Save failed',
}

function StateIcon({ state }: { state: SaveState }) {
  if (state === 'error') return <AlertTriangle size={12} />
  if (state === 'clean') return <Check size={12} />
  return <Circle size={8} />
}

export function SaveStatus({ state, error, onRetry, onDismiss }: SaveStatusProps) {
  return (
    <div className={`save-status ${state}`} role="status" aria-live="polite">
      <StateIcon state={state} />
      <span>{LABEL[state]}</span>
      {state === 'error' && (
        <>
          {error && (
            <span
              className="save-status-detail"
              title={`${error}. Your edit is still here — nothing was lost. Click Retry to try again.`}
            >
              {error}
            </span>
          )}
          <button onClick={onRetry} title="Retry save" aria-label="Retry save">
            <RotateCw size={12} />
          </button>
          <button onClick={onDismiss} title="Dismiss" aria-label="Dismiss save error">
            <X size={12} />
          </button>
        </>
      )}
    </div>
  )
}
