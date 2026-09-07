import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { listen } from '@tauri-apps/api/event'
import { api } from '../lib/tauri'

// PTY output crosses the IPC boundary as base64 (see commands/terminal.rs) —
// bytes, not a decoded string, so a multi-byte character split across two
// reads is xterm's own parser's problem to reassemble, not this hook's.
function decodeChunk(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function useTerminal(
  containerRef: RefObject<HTMLDivElement | null>,
  workspace: string,
  notePath: string | null,
) {
  const termRef = useRef<Terminal | null>(null)
  // terminal_open (spawning a real shell process) is async and not
  // instantaneous. A write issued before it resolves — a fast click on the
  // insert-path button, or a fast typist — hits "no terminal session is
  // open" on the backend. Every write path (typed input and insertText)
  // chains onto this instead of firing the moment the component mounts.
  const readyRef = useRef<Promise<void>>(Promise.resolve())
  // Surfaces the same gap as an "starting shell…" state instead of a blank
  // pane with no feedback at all.
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({ convertEol: true, fontSize: 13 })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()
    termRef.current = term

    const ready = api.terminal.open(workspace, notePath).then(() => {
      void api.terminal.resize(term.cols, term.rows)
      setIsReady(true)
    })
    readyRef.current = ready

    const dataSub = term.onData((data) => void ready.then(() => api.terminal.write(data)))
    const outputUnlisten = listen<string>('terminal-output', (event) => {
      term.write(decodeChunk(event.payload))
    })

    const resizeObserver = new ResizeObserver(() => {
      fit.fit()
      void ready.then(() => api.terminal.resize(term.cols, term.rows))
    })
    resizeObserver.observe(container)

    return () => {
      dataSub.dispose()
      void outputUnlisten.then((off) => off())
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
    }
    // Deliberately empty: this effect spawns the session once on mount
    // (TerminalPane lazy-mounts exactly once — see its own comment) and never
    // re-runs for a workspace/note/shell change, matching the design's
    // "switching workspaces doesn't respawn a running terminal" decision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function insertText(text: string) {
    void readyRef.current.then(() => api.terminal.write(text))
  }

  async function kill() {
    await api.terminal.close()
  }

  return { insertText, kill, isReady }
}
