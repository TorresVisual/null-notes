import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { applyCodeRunMeta, decodeBase64Text } from './CodeBlockRun'
import type { RunEntry } from './CodeBlockRun'

vi.mock('../../lib/tauri', () => ({
  api: { codeRun: { run: vi.fn(), sendInput: vi.fn(), stop: vi.fn() } },
}))
vi.mock('../../store/codeRunConfirm', () => ({
  useCodeRunConfirmStore: { getState: () => ({ confirmNote: vi.fn().mockResolvedValue(true) }) },
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
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
})

afterEach(() => {
  editor?.destroy()
  editor = null
  document.body.innerHTML = ''
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

describe('decodeBase64Text', () => {
  it('round-trips plain ASCII', () => {
    expect(decodeBase64Text(btoa('hello\n'))).toBe('hello\n')
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
