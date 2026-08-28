import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { listen } from '@tauri-apps/api/event'
import { api } from '../../lib/tauri'
import { useCodeRunConfirmStore } from '../../store/codeRunConfirm'
import { useSettingsStore } from '../../store/settings'
import { useWorkspaceStore } from '../../store/workspace'

/**
 * Run button + output panel on every `python`/`cpp`/`c++`/`c` code block
 * (P10-2). No sandbox — see docs/specs/code-execution-design.md. Nothing
 * here is written to the note: the panel is a widget decoration, and its
 * content lives entirely in this plugin's own state, the same
 * presentation-only shape as `CodeBlockToolbar`'s fold state and
 * `CodeBlockSearch`'s query state.
 */

export const RUNNABLE_LANGUAGES = new Set(['python', 'cpp', 'c++', 'c'])

export interface RunEntry {
  runId: string
  status: 'starting' | 'running' | 'exited' | 'timeout' | 'stopped'
  exitCode: number | null
  output: { stream: 'stdout' | 'stderr'; text: string }[]
}

export type CodeRunMeta =
  | { type: 'start'; pos: number; runId: string }
  | { type: 'output'; runId: string; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'exit'; runId: string; code: number | null }
  | { type: 'timeout'; runId: string }
  | { type: 'stopped'; runId: string }
  | { type: 'close'; pos: number }

function posForRunId(entries: Map<number, RunEntry>, runId: string): number | null {
  for (const [pos, entry] of entries) {
    if (entry.runId === runId) return pos
  }
  return null
}

/**
 * Pure reducer backing `CodeBlockRun`'s ProseMirror plugin state — kept
 * separate from the plugin itself so the transition logic is unit-testable
 * without mounting an editor, the same split `CodeBlockSearch.ts`'s
 * `findMatches` makes.
 */
export function applyCodeRunMeta(entries: Map<number, RunEntry>, meta: CodeRunMeta): Map<number, RunEntry> {
  if (meta.type === 'start') {
    const next = new Map(entries)
    next.set(meta.pos, { runId: meta.runId, status: 'starting', exitCode: null, output: [] })
    return next
  }

  if (meta.type === 'close') {
    if (!entries.has(meta.pos)) return entries
    const next = new Map(entries)
    next.delete(meta.pos)
    return next
  }

  const pos = posForRunId(entries, meta.runId)
  if (pos === null) return entries
  // Non-null: `pos` came from `posForRunId`, which only ever returns a key
  // that exists in `entries`.
  const entry = entries.get(pos)!

  if (meta.type === 'output') {
    const next = new Map(entries)
    next.set(pos, {
      ...entry,
      status: entry.status === 'starting' ? 'running' : entry.status,
      output: [...entry.output, { stream: meta.stream, text: meta.text }],
    })
    return next
  }

  if (meta.type === 'exit') {
    const next = new Map(entries)
    next.set(pos, { ...entry, status: 'exited', exitCode: meta.code })
    return next
  }

  if (meta.type === 'timeout') {
    const next = new Map(entries)
    next.set(pos, { ...entry, status: 'timeout' })
    return next
  }

  // 'stopped'
  const next = new Map(entries)
  next.set(pos, { ...entry, status: 'stopped' })
  return next
}

/** Base64 (as emitted by `commands::code_run::emit_output`) to a UTF-8 string. */
export function decodeBase64Text(base64: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

const codeRunKey = new PluginKey<Map<number, RunEntry>>('codeBlockRun')

interface OutputPayload {
  runId: string
  stream: 'stdout' | 'stderr'
  data: string
}
interface ExitPayload {
  runId: string
  code: number | null
}
interface TimeoutPayload {
  runId: string
}

function runPanel(pos: number): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'code-run-panel'
  panel.contentEditable = 'false'
  panel.setAttribute('data-code-run-pos', String(pos))

  const run = document.createElement('button')
  run.type = 'button'
  run.className = 'code-run-run'
  run.dataset['action'] = 'run'
  run.textContent = 'Run'
  panel.appendChild(run)

  const stop = document.createElement('button')
  stop.type = 'button'
  stop.className = 'code-run-stop'
  stop.dataset['action'] = 'stop'
  stop.textContent = 'Stop'
  stop.hidden = true
  panel.appendChild(stop)

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'code-run-close'
  close.dataset['action'] = 'close'
  close.textContent = 'Dismiss'
  close.hidden = true
  panel.appendChild(close)

  const output = document.createElement('pre')
  output.className = 'code-run-output'
  output.hidden = true
  panel.appendChild(output)

  const stdinRow = document.createElement('div')
  stdinRow.className = 'code-run-stdin-row'
  stdinRow.hidden = true
  const stdinInput = document.createElement('input')
  stdinInput.type = 'text'
  stdinInput.className = 'code-run-stdin'
  stdinInput.placeholder = 'stdin…'
  stdinRow.appendChild(stdinInput)
  panel.appendChild(stdinRow)

  return panel
}

function decorate(state: EditorState): DecorationSet {
  const decorations: Decoration[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    const language = String(node.attrs['language'] ?? '')
    if (!RUNNABLE_LANGUAGES.has(language)) return false

    decorations.push(
      Decoration.widget(pos + node.nodeSize, () => runPanel(pos), {
        key: `code-run-${pos}`,
        side: 1,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    )
    return false
  })
  return DecorationSet.create(state.doc, decorations)
}

function syncRunPanelUi(view: EditorView) {
  const entries = codeRunKey.getState(view.state) ?? new Map<number, RunEntry>()
  view.dom.querySelectorAll('.code-run-panel').forEach((el) => {
    if (!(el instanceof HTMLElement)) return
    const pos = Number(el.getAttribute('data-code-run-pos'))
    const entry = entries.get(pos)

    const run = el.querySelector('.code-run-run')
    const stop = el.querySelector('.code-run-stop')
    const close = el.querySelector('.code-run-close')
    const output = el.querySelector('.code-run-output')
    const stdinRow = el.querySelector('.code-run-stdin-row')
    if (
      !(run instanceof HTMLElement) ||
      !(stop instanceof HTMLElement) ||
      !(close instanceof HTMLElement) ||
      !(output instanceof HTMLElement) ||
      !(stdinRow instanceof HTMLElement)
    ) {
      return
    }

    if (!entry) {
      run.hidden = false
      stop.hidden = true
      close.hidden = true
      output.hidden = true
      stdinRow.hidden = true
      return
    }

    const running = entry.status === 'starting' || entry.status === 'running'
    run.hidden = true
    stop.hidden = !running
    close.hidden = running
    output.hidden = false
    stdinRow.hidden = !running

    let text = entry.output.map((chunk) => chunk.text).join('')
    if (entry.status === 'exited') text += `\n[exited with code ${entry.exitCode ?? 'unknown'}]`
    if (entry.status === 'timeout') text += '\n[stopped: exceeded the run timeout]'
    if (entry.status === 'stopped') text += '\n[stopped]'
    output.textContent = text
    output.scrollTop = output.scrollHeight
  })
}

export const CodeBlockRun = Extension.create({
  name: 'codeBlockRun',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeRunKey,
        state: {
          init: () => new Map<number, RunEntry>(),
          apply: (tr, entries) => {
            const meta = tr.getMeta(codeRunKey) as CodeRunMeta | undefined
            if (meta) return applyCodeRunMeta(entries, meta)
            if (!tr.docChanged || entries.size === 0) return entries

            const mapped = new Map<number, RunEntry>()
            entries.forEach((entry, pos) => {
              const next = tr.mapping.map(pos)
              if (tr.doc.nodeAt(next)?.type.name === 'codeBlock') mapped.set(next, entry)
            })
            return mapped
          },
        },
        props: {
          decorations(state) {
            return decorate(state)
          },
        },
        view(view: EditorView) {
          // Registered lazily, on the first Run click, not at plugin-view
          // creation. Every note's editor mounts this plugin regardless of
          // whether it ever runs anything, and eagerly calling `listen`
          // requires real Tauri IPC to be present — exactly the kind of
          // unconditional side effect `CodeBlockOpenInIde`'s own `ask()`
          // avoids by gating on live app state first.
          const unlistenFns: (() => void)[] = []
          let listening: Promise<void> | null = null

          function ensureListening(): Promise<void> {
            if (!listening) {
              listening = Promise.all([
                listen<OutputPayload>('code-run-output', (event) => {
                  view.dispatch(
                    view.state.tr.setMeta(codeRunKey, {
                      type: 'output',
                      runId: event.payload.runId,
                      stream: event.payload.stream,
                      text: decodeBase64Text(event.payload.data),
                    }),
                  )
                }),
                listen<ExitPayload>('code-run-exit', (event) => {
                  view.dispatch(
                    view.state.tr.setMeta(codeRunKey, {
                      type: 'exit',
                      runId: event.payload.runId,
                      code: event.payload.code,
                    }),
                  )
                }),
                listen<TimeoutPayload>('code-run-timeout', (event) => {
                  view.dispatch(view.state.tr.setMeta(codeRunKey, { type: 'timeout', runId: event.payload.runId }))
                }),
              ]).then((offs) => {
                unlistenFns.push(...offs)
              })
            }
            return listening
          }

          const onClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null
            const panelEl = target?.closest?.('.code-run-panel')
            if (!(panelEl instanceof HTMLElement)) return
            const pos = Number(panelEl.getAttribute('data-code-run-pos'))
            if (!Number.isInteger(pos)) return
            const action = target?.closest?.('button')?.getAttribute('data-action')
            if (!action) return
            event.preventDefault()

            if (action === 'run') {
              const node = view.state.doc.nodeAt(pos)
              if (!node) return
              const language = String(node.attrs['language'] ?? '')
              const source = node.textContent
              const notePath = useWorkspaceStore.getState().activeTab
              if (!notePath) return

              void useCodeRunConfirmStore
                .getState()
                .confirmNote(notePath)
                .then((allowed) => {
                  if (!allowed) return
                  return ensureListening().then(() => {
                    const runId = crypto.randomUUID()
                    view.dispatch(view.state.tr.setMeta(codeRunKey, { type: 'start', pos, runId }))
                    const settings = useSettingsStore.getState().settings
                    void api.codeRun.run(
                      runId,
                      language,
                      source,
                      settings.pythonCommand,
                      settings.cppCompilerCommand,
                      settings.codeRunTimeoutSecs,
                    )
                  })
                })
              return
            }

            const entries = codeRunKey.getState(view.state) ?? new Map<number, RunEntry>()
            const entry = entries.get(pos)
            if (!entry) return

            if (action === 'stop') {
              void api.codeRun.stop(entry.runId)
              view.dispatch(view.state.tr.setMeta(codeRunKey, { type: 'stopped', runId: entry.runId }))
            } else if (action === 'close') {
              view.dispatch(view.state.tr.setMeta(codeRunKey, { type: 'close', pos }))
            }
          }

          const onKeydown = (event: KeyboardEvent) => {
            if (event.key !== 'Enter') return
            const target = event.target as HTMLElement | null
            if (!target?.classList?.contains('code-run-stdin')) return
            const panelEl = target.closest('.code-run-panel')
            const pos = Number(panelEl?.getAttribute('data-code-run-pos'))
            if (!Number.isInteger(pos)) return
            const entries = codeRunKey.getState(view.state) ?? new Map<number, RunEntry>()
            const entry = entries.get(pos)
            if (!entry) return
            const input = target as HTMLInputElement
            void api.codeRun.sendInput(entry.runId, input.value)
            input.value = ''
          }

          view.dom.addEventListener('click', onClick)
          view.dom.addEventListener('keydown', onKeydown)

          return {
            update: syncRunPanelUi,
            destroy: () => {
              view.dom.removeEventListener('click', onClick)
              view.dom.removeEventListener('keydown', onKeydown)
              unlistenFns.forEach((off) => off())
            },
          }
        },
      }),
    ]
  },
})
