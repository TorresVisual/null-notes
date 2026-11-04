import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { listen } from '@tauri-apps/api/event'
import { confirm } from '@tauri-apps/plugin-dialog'
import { api } from '../../lib/tauri'
import { useCodeRunConfirmStore } from '../../store/codeRunConfirm'
import { useSettingsStore } from '../../store/settings'
import { useWorkspaceStore } from '../../store/workspace'
import { isMobile, isWeb } from '../../lib/platform'

/**
 * Run button + output panel on every `python`/`cpp`/`c++`/`c` code block
 * (P10-2). No sandbox — see docs/specs/code-execution-design.md. The panel
 * itself is a widget decoration and its live output lives entirely in this
 * plugin's own state, the same presentation-only shape as
 * `CodeBlockToolbar`'s fold state and `CodeBlockSearch`'s query state —
 * "Pin output" is the one escape hatch, writing a snapshot of that state
 * into the doc as a plain (language `''`, so it's never itself runnable)
 * code block, through the normal save path.
 *
 * Issue 50 adds expected output assertions: if a code block is followed by
 * an `expect` (or `expected`) code block, the captured stdout is diffed against
 * the expected output, showing a pass/fail indicator and comparison diff.
 */

export const RUNNABLE_LANGUAGES = new Set(['python', 'cpp', 'c++', 'c'])

export interface RunEntry {
  runId: string
  status: 'starting' | 'running' | 'exited' | 'timeout' | 'stopped'
  exitCode: number | null
  output: { stream: 'stdout' | 'stderr'; text: string }[]
  expectedOutput?: string | null
}

export type CodeRunMeta =
  | { type: 'start'; pos: number; runId: string; expectedOutput?: string | null }
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
 * Normalizes output and expected text for comparison:
 * standardizes CRLF to LF, trims trailing whitespace per line,
 * and strips trailing newlines.
 */
export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd()
}

/**
 * Finds a sibling `expect` or `expected` code block immediately following the code block at `pos`.
 * Skips intervening empty paragraphs if present.
 */
export function findExpectedOutput(doc: ProseMirrorNode, pos: number): { pos: number; text: string } | null {
  const node = doc.nodeAt(pos)
  if (!node || node.type.name !== 'codeBlock') return null
  let nextPos = pos + node.nodeSize
  if (nextPos >= doc.content.size) return null

  let nextNode = doc.nodeAt(nextPos)
  if (nextNode && nextNode.type.name === 'paragraph' && nextNode.textContent.trim() === '') {
    nextPos += nextNode.nodeSize
    nextNode = nextPos < doc.content.size ? doc.nodeAt(nextPos) : null
  }

  if (nextNode && nextNode.type.name === 'codeBlock') {
    const lang = String(nextNode.attrs['language'] ?? '').toLowerCase()
    if (lang === 'expect' || lang === 'expected') {
      return { pos: nextPos, text: nextNode.textContent }
    }
  }
  return null
}

export interface AssertionStatus {
  result: 'pass' | 'fail' | null
  reason?: string
}

/** Evaluates the pass/fail assertion status of a run against its expected output. */
export function assertionStatus(entry: RunEntry): AssertionStatus {
  if (entry.expectedOutput === undefined || entry.expectedOutput === null) {
    return { result: null }
  }
  if (entry.status === 'starting' || entry.status === 'running' || entry.status === 'stopped') {
    return { result: null }
  }
  if (entry.status === 'timeout') {
    return { result: 'fail', reason: 'timeout' }
  }
  if (entry.status === 'exited') {
    if (entry.exitCode !== 0) {
      return { result: 'fail', reason: `exit code ${entry.exitCode ?? 'unknown'}` }
    }
    const actualStdout = entry.output
      .filter((chunk) => chunk.stream === 'stdout')
      .map((chunk) => chunk.text)
      .join('')
    if (normalizeOutput(actualStdout) === normalizeOutput(entry.expectedOutput)) {
      return { result: 'pass' }
    }
    return { result: 'fail', reason: 'output mismatch' }
  }
  return { result: null }
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
    next.set(meta.pos, {
      runId: meta.runId,
      status: 'starting',
      exitCode: null,
      output: [],
      expectedOutput: meta.expectedOutput ?? null,
    })
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

/** Top-level module a finished Python run could not import, from its `ModuleNotFoundError` traceback. */
export function missingModule(entry: RunEntry): string | null {
  if (entry.status !== 'exited' || entry.exitCode === 0) return null
  const stderr = entry.output
    .filter((c) => c.stream === 'stderr')
    .map((c) => c.text)
    .join('')
  return /ModuleNotFoundError: No module named '(\w+)/.exec(stderr)?.[1] ?? null
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
  panel.innerHTML = `
    <div class="code-run-bar">
      <button type="button" class="code-run-run" data-action="run">Run</button>
      <button type="button" class="code-run-stop" data-action="stop" hidden>Stop</button>
      <button type="button" class="code-run-install" data-action="install" hidden></button>
      <button type="button" class="code-run-expect" data-action="expect">Add expected</button>
      <button type="button" class="code-run-pin" data-action="pin" hidden>Pin output</button>
      <button type="button" class="code-run-close" data-action="close" hidden>Dismiss</button>
      <span class="code-run-assertion" hidden></span>
    </div>
    <pre class="code-run-output" hidden></pre>
    <div class="code-run-stdin-row" hidden>
      <input type="text" class="code-run-stdin" placeholder="stdin…">
    </div>
  `

  return panel
}

/** Text pinned into the note and shown in the live panel — kept identical so what you pin is what you saw. */
export function formatRunOutput(entry: RunEntry): string {
  let text = entry.output.map((chunk) => chunk.text).join('')
  if (entry.status === 'exited') text += `\n[exited with code ${entry.exitCode ?? 'unknown'}]`
  if (entry.status === 'timeout') text += '\n[stopped: exceeded the run timeout]'
  if (entry.status === 'stopped') text += '\n[stopped]'

  if (entry.expectedOutput !== undefined && entry.expectedOutput !== null) {
    const assertion = assertionStatus(entry)
    if (assertion.result === 'pass') {
      text += '\n[assertion: passed]'
    } else if (assertion.result === 'fail') {
      if (assertion.reason === 'output mismatch') {
        const actualStdout = entry.output
          .filter((c) => c.stream === 'stdout')
          .map((c) => c.text)
          .join('')
        const stderr = entry.output
          .filter((c) => c.stream === 'stderr')
          .map((c) => c.text)
          .join('')
        let diff = `Expected:\n${entry.expectedOutput}\n\nActual:\n${actualStdout}`
        if (stderr) diff += `\nStderr:\n${stderr}`
        diff += `\n[exited with code ${entry.exitCode ?? 'unknown'}]\n[assertion: failed (output mismatch)]`
        return diff
      } else {
        text += `\n[assertion: failed (${assertion.reason})]`
      }
    }
  }

  return text
}

function decorate(state: EditorState): DecorationSet {
  if (isMobile() || isWeb()) return DecorationSet.empty

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
    const expectBtn = el.querySelector('.code-run-expect')
    const install = el.querySelector('.code-run-install')
    const pin = el.querySelector('.code-run-pin')
    const close = el.querySelector('.code-run-close')
    const assertion = el.querySelector('.code-run-assertion')
    const output = el.querySelector('.code-run-output')
    const stdinRow = el.querySelector('.code-run-stdin-row')
    if (
      !(run instanceof HTMLElement) ||
      !(stop instanceof HTMLElement) ||
      !(expectBtn instanceof HTMLElement) ||
      !(install instanceof HTMLElement) ||
      !(pin instanceof HTMLElement) ||
      !(close instanceof HTMLElement) ||
      !(assertion instanceof HTMLElement) ||
      !(output instanceof HTMLElement) ||
      !(stdinRow instanceof HTMLElement)
    ) {
      return
    }

    const hasExpect = findExpectedOutput(view.state.doc, pos) !== null

    if (!entry) {
      run.hidden = false
      stop.hidden = true
      expectBtn.hidden = hasExpect
      expectBtn.textContent = 'Add expected'
      expectBtn.title = 'Add an expected output block below'
      install.hidden = true
      pin.hidden = true
      close.hidden = true
      assertion.hidden = true
      assertion.textContent = ''
      assertion.className = 'code-run-assertion'
      output.hidden = true
      stdinRow.hidden = true
      return
    }

    const running = entry.status === 'starting' || entry.status === 'running'
    run.hidden = true
    stop.hidden = !running
    pin.hidden = running
    close.hidden = running
    output.hidden = false
    stdinRow.hidden = !running

    if (!running && !hasExpect && entry.output.some((c) => c.stream === 'stdout' && c.text.trim())) {
      expectBtn.hidden = false
      expectBtn.textContent = 'Set as expected'
      expectBtn.title = 'Use this output as the expected output block'
    } else {
      expectBtn.hidden = true
    }

    const missing = missingModule(entry)
    install.hidden = missing === null
    if (missing) install.textContent = `Install ${missing} and re-run`

    const assertRes = assertionStatus(entry)
    if (assertRes.result === 'pass') {
      assertion.hidden = false
      assertion.className = 'code-run-assertion pass'
      assertion.textContent = '✓ Passed'
    } else if (assertRes.result === 'fail') {
      assertion.hidden = false
      assertion.className = 'code-run-assertion fail'
      assertion.textContent =
        assertRes.reason === 'timeout'
          ? '✗ Timed out'
          : assertRes.reason === 'output mismatch'
            ? '✗ Failed'
            : `✗ Failed (${assertRes.reason})`
    } else {
      assertion.hidden = true
      assertion.textContent = ''
      assertion.className = 'code-run-assertion'
    }

    output.textContent = formatRunOutput(entry)
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

          function startRun(pos: number) {
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
                  const expected = findExpectedOutput(view.state.doc, pos)
                  const expectedOutput = expected ? expected.text : null
                  view.dispatch(view.state.tr.setMeta(codeRunKey, { type: 'start', pos, runId, expectedOutput }))
                  const settings = useSettingsStore.getState().settings
                  void api.codeRun.run(runId, language, source, settings.codeRunTimeoutSecs)
                })
              })
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
              startRun(pos)
              return
            }

            const entries = codeRunKey.getState(view.state) ?? new Map<number, RunEntry>()
            const entry = entries.get(pos)

            if (action === 'install') {
              const module = entry ? missingModule(entry) : null
              if (!entry || !module) return
              void (async () => {
                const ok = await confirm(
                  `Run "pip install ${module}" on your machine? It downloads and runs code from PyPI with no sandbox.`,
                )
                if (!ok) return
                try {
                  await api.codeRun.installPackage(module)
                } catch (e) {
                  view.dispatch(
                    view.state.tr.setMeta(codeRunKey, {
                      type: 'output',
                      runId: entry.runId,
                      stream: 'stderr',
                      text: `\n[pip install ${module} failed]\n${String(e)}\n`,
                    }),
                  )
                  return
                }
                startRun(pos)
              })()
              return
            }

            if (action === 'expect') {
              const node = view.state.doc.nodeAt(pos)
              if (!node) return
              const text = entry
                ? entry.output
                    .filter((c) => c.stream === 'stdout')
                    .map((c) => c.text)
                    .join('')
                    .trimEnd()
                : ''
              const schema = view.state.schema
              const expectNode = schema.nodes['codeBlock']!.create(
                { language: 'expect' },
                text ? schema.text(text) : undefined,
              )
              view.dispatch(view.state.tr.insert(pos + node.nodeSize, expectNode))
              return
            }

            if (!entry) return

            if (action === 'stop') {
              void api.codeRun.stop(entry.runId)
              view.dispatch(view.state.tr.setMeta(codeRunKey, { type: 'stopped', runId: entry.runId }))
            } else if (action === 'close') {
              view.dispatch(view.state.tr.setMeta(codeRunKey, { type: 'close', pos }))
            } else if (action === 'pin') {
              const node = view.state.doc.nodeAt(pos)
              if (!node) return
              const text = formatRunOutput(entry)
              const schema = view.state.schema
              const outputNode = schema.nodes['codeBlock']!.create(
                { language: '' },
                text ? schema.text(text) : undefined,
              )
              view.dispatch(
                view.state.tr.insert(pos + node.nodeSize, outputNode).setMeta(codeRunKey, { type: 'close', pos }),
              )
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

