import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { applyCodeRunMeta, decodeBase64Text, formatRunOutput } from './CodeBlockRun'
import type { RunEntry } from './CodeBlockRun'
import { api } from '../../lib/tauri'
import { useWorkspaceStore } from '../../store/workspace'

const { listenCallbacks } = vi.hoisted(() => ({
  listenCallbacks: new Map<string, (event: { payload: unknown }) => void>(),
}))

vi.mock('../../lib/tauri', () => ({
  api: { codeRun: { run: vi.fn(), sendInput: vi.fn(), stop: vi.fn() } },
}))
vi.mock('../../store/codeRunConfirm', () => ({
  useCodeRunConfirmStore: { getState: () => ({ confirmNote: vi.fn().mockResolvedValue(true) }) },
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event: string, cb: (e: { payload: unknown }) => void) => {
    listenCallbacks.set(event, cb)
    return Promise.resolve(() => {})
  }),
}))

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./index')

let editor: InstanceType<typeof Editor> | null = null

function mount(content: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content })
  return editor
}

function codeBlock(language: string, text = 'print(1)'): string {
  return `<pre><code class="language-${language}">${text}</code></pre>`
}

beforeEach(() => {
  vi.clearAllMocks()
  listenCallbacks.clear()
})

afterEach(() => {
  editor?.destroy()
  editor = null
  document.body.innerHTML = ''
  useWorkspaceStore.getState().setActiveTab(null)
})

describe('CodeBlockRun panel visibility', () => {
  it('shows a Run button on a python code block', () => {
    mount(codeBlock('python'))
    expect(editor?.view.dom.querySelector('.code-run-run')).not.toBeNull()
  })

  it('shows a Run button on a cpp code block', () => {
    mount(codeBlock('cpp', 'int main(){}'))
    expect(editor?.view.dom.querySelector('.code-run-run')).not.toBeNull()
  })

  it('does not show a Run button on an unsupported language', () => {
    mount(codeBlock('rust', 'fn main() {}'))
    expect(editor?.view.dom.querySelector('.code-run-run')).toBeNull()
  })
})

describe('formatRunOutput', () => {
  it('joins output chunks and appends the exit code', () => {
    const entry: RunEntry = {
      runId: 'r1',
      status: 'exited',
      exitCode: 0,
      output: [
        { stream: 'stdout', text: 'hi' },
        { stream: 'stdout', text: '\n' },
      ],
    }
    expect(formatRunOutput(entry)).toBe('hi\n\n[exited with code 0]')
  })

  it('notes a timeout with no exit code', () => {
    const entry: RunEntry = { runId: 'r1', status: 'timeout', exitCode: null, output: [] }
    expect(formatRunOutput(entry)).toBe('\n[stopped: exceeded the run timeout]')
  })
})

describe('decodeBase64Text', () => {
  it('round-trips plain ASCII', () => {
    expect(decodeBase64Text(btoa('hello\n'))).toBe('hello\n')
  })
})

describe('Pin output', () => {
  it('writes the finished run into the note and closes the panel', async () => {
    useWorkspaceStore.getState().setActiveTab('note.md')
    mount(codeBlock('python'))
    const run = editor!.view.dom.querySelector('.code-run-run')
    expect(run).not.toBeNull()
    run!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await vi.waitFor(() => expect(api.codeRun.run).toHaveBeenCalled())
    const runId = vi.mocked(api.codeRun.run).mock.calls[0]![0] as string

    listenCallbacks.get('code-run-output')?.({ payload: { runId, stream: 'stdout', data: btoa('42\n') } })
    listenCallbacks.get('code-run-exit')?.({ payload: { runId, code: 0 } })

    const pin = editor!.view.dom.querySelector('.code-run-pin')
    expect(pin).not.toBeNull()
    expect((pin as HTMLElement).hidden).toBe(false)
    pin!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const codeBlocks: string[] = []
    editor!.state.doc.descendants((node) => {
      if (node.type.name === 'codeBlock') codeBlocks.push(node.textContent)
      return true
    })
    expect(codeBlocks).toEqual(['print(1)', '42\n\n[exited with code 0]'])

    // Panel entry closed: back to the pre-run Run button, output panel hidden again.
    expect((editor!.view.dom.querySelector('.code-run-run') as HTMLElement).hidden).toBe(false)
    expect((editor!.view.dom.querySelector('.code-run-output') as HTMLElement).hidden).toBe(true)
  })
})

describe('applyCodeRunMeta', () => {
  it('start creates a fresh entry at the given position', () => {
    const entries = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    expect(entries.get(5)).toEqual<RunEntry>({ runId: 'r1', status: 'starting', exitCode: null, output: [] })
  })

  it('start replaces a prior entry at the same position', () => {
    const first = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const withOutput = applyCodeRunMeta(first, { type: 'output', runId: 'r1', stream: 'stdout', text: 'old\n' })

    const restarted = applyCodeRunMeta(withOutput, { type: 'start', pos: 5, runId: 'r2' })

    expect(restarted.get(5)).toEqual<RunEntry>({ runId: 'r2', status: 'starting', exitCode: null, output: [] })
  })

  it('output appends a chunk and flips status to running', () => {
    const started = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const next = applyCodeRunMeta(started, { type: 'output', runId: 'r1', stream: 'stdout', text: 'hi\n' })

    expect(next.get(5)).toEqual<RunEntry>({
      runId: 'r1',
      status: 'running',
      exitCode: null,
      output: [{ stream: 'stdout', text: 'hi\n' }],
    })
  })

  it('output for an unknown run id is a no-op', () => {
    const started = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const next = applyCodeRunMeta(started, { type: 'output', runId: 'other', stream: 'stdout', text: 'hi\n' })

    expect(next).toBe(started)
  })

  it('exit sets status and exit code', () => {
    const started = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const next = applyCodeRunMeta(started, { type: 'exit', runId: 'r1', code: 2 })

    expect(next.get(5)).toEqual<RunEntry>({ runId: 'r1', status: 'exited', exitCode: 2, output: [] })
  })

  it('timeout sets status without an exit code', () => {
    const started = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const next = applyCodeRunMeta(started, { type: 'timeout', runId: 'r1' })

    expect(next.get(5)?.status).toBe('timeout')
  })

  it('stopped sets status immediately, without waiting on the backend', () => {
    const started = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const next = applyCodeRunMeta(started, { type: 'stopped', runId: 'r1' })

    expect(next.get(5)?.status).toBe('stopped')
  })

  it('close removes the entry at a position', () => {
    const started = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const next = applyCodeRunMeta(started, { type: 'close', pos: 5 })

    expect(next.has(5)).toBe(false)
  })
})
