import { useRef } from 'react'
import { X } from 'lucide-react'
import { useTerminal } from '../hooks/useTerminal'

interface TerminalPaneProps {
  workspace: string
  notePath: string | null
  shell: string
  hidden: boolean
  onClose: () => void
}

// Lazy-mounted exactly once by Layout (see its own comment) and then only
// ever hidden/shown via CSS — the whole point is that the shell underneath
// survives the panel being toggled shut, so this component must never
// unmount as a side effect of the toggle.
export function TerminalPane({ workspace, notePath, shell, hidden, onClose }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { insertText, kill } = useTerminal(containerRef, workspace, notePath, shell)

  const noteLabel = notePath ? notePath.split(/[\\/]/).pop() : null

  return (
    <div className="terminal-pane" style={{ display: hidden ? 'none' : 'flex' }}>
      <div className="terminal-pane-header">
        {noteLabel && (
          <button
            className="terminal-pane-insert"
            title="Insert this note's path at the cursor"
            onClick={() => notePath && insertText(notePath)}
          >
            {noteLabel}
          </button>
        )}
        <button
          className="terminal-pane-kill"
          title="Kill terminal"
          onClick={() => {
            void kill()
            onClose()
          }}
        >
          <X size={14} />
        </button>
      </div>
      <div className="terminal-pane-body" ref={containerRef} />
    </div>
  )
}
