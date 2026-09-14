import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  applyCodeRunMeta,
  decodeBase64Text,
  formatRunOutput,
  normalizeOutput,
  findExpectedOutput,
  assertionStatus,
} from './CodeBlockRun'
import type { RunEntry } from './CodeBlockRun'
import { api } from '../../lib/tauri'
import { useWorkspaceStore } from '../../store/workspace'
import { platform } from '@tauri-apps/plugin-os'

const { listenCallbacks } = vi.hoisted(() => ({
  listenCallbacks: new Map<string, (event: { payload: unknown }) => void>(),
}))

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))
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

describe('CodeBlockRun on mobile', () => {
  it('hides the entire run panel on iOS even for a runnable language', () => {
    vi.mocked(platform).mockReturnValue('ios')
    mount(codeBlock('python'))
    expect(editor?.view.dom.querySelector('.code-run-run')).toBeNull()
    expect(editor?.view.dom.querySelector('.code-run-panel')).toBeNull()
  })

  it('still shows the run panel on desktop', () => {
    vi.mocked(platform).mockReturnValue('windows')
    mount(codeBlock('python'))
    expect(editor?.view.dom.querySelector('.code-run-run')).not.toBeNull()
  })
})

describe('normalizeOutput', () => {
  it('normalizes CRLF to LF and trims trailing whitespace per line and overall', () => {
    expect(normalizeOutput('hello \r\nworld   \r\n\r\n')).toBe('hello\nworld')
    expect(normalizeOutput('42\n')).toBe('42')
    expect(normalizeOutput('  leading is preserved \n')).toBe('  leading is preserved')
  })
})

describe('findExpectedOutput', () => {
  it('finds adjacent expect code block', () => {
    mount(`${codeBlock('python', 'print(42)')}${codeBlock('expect', '42')}`)
    const codeBlockPos = 0
    const expected = findExpectedOutput(editor!.state.doc, codeBlockPos)
    expect(expected).not.toBeNull()
    expect(expected?.text).toBe('42')
  })

  it('finds expect code block separated by an empty paragraph', () => {
    mount(`${codeBlock('python', 'print(42)')}<p></p>${codeBlock('expect', '42')}`)
    const codeBlockPos = 0
    const expected = findExpectedOutput(editor!.state.doc, codeBlockPos)
    expect(expected).not.toBeNull()
    expect(expected?.text).toBe('42')
  })

  it('returns null when no expect block follows', () => {
    mount(`${codeBlock('python', 'print(42)')}<p>Some prose</p>${codeBlock('python', 'print(10)')}`)
    const codeBlockPos = 0
    const expected = findExpectedOutput(editor!.state.doc, codeBlockPos)
    expect(expected).toBeNull()
  })
})

describe('assertionStatus', () => {
  it('returns null when no expected output is set', () => {
    const entry: RunEntry = { runId: 'r1', status: 'exited', exitCode: 0, output: [{ stream: 'stdout', text: '42\n' }] }
    expect(assertionStatus(entry)).toEqual({ result: null })
  })

  it('returns pass when output matches expected text', () => {
    const entry: RunEntry = {
      runId: 'r1',
      status: 'exited',
      exitCode: 0,
      output: [{ stream: 'stdout', text: '42\n' }],
      expectedOutput: '42',
    }
    expect(assertionStatus(entry)).toEqual({ result: 'pass' })
  })

  it('returns fail on output mismatch', () => {
    const entry: RunEntry = {
      runId: 'r1',
      status: 'exited',
      exitCode: 0,
      output: [{ stream: 'stdout', text: '43\n' }],
      expectedOutput: '42',
    }
    expect(assertionStatus(entry)).toEqual({ result: 'fail', reason: 'output mismatch' })
  })

  it('returns fail on nonzero exit code', () => {
    const entry: RunEntry = {
      runId: 'r1',
      status: 'exited',
      exitCode: 1,
      output: [{ stream: 'stderr', text: 'Error\n' }],
      expectedOutput: '42',
    }
    expect(assertionStatus(entry)).toEqual({ result: 'fail', reason: 'exit code 1' })
  })

  it('returns fail on timeout', () => {
    const entry: RunEntry = {
      runId: 'r1',
      status: 'timeout',
      exitCode: null,
      output: [],
      expectedOutput: '42',
    }
    expect(assertionStatus(entry)).toEqual({ result: 'fail', reason: 'timeout' })
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

  it('formats passed assertion cleanly', () => {
    const entry: RunEntry = {
      runId: 'r1',
      status: 'exited',
      exitCode: 0,
      output: [{ stream: 'stdout', text: '42\n' }],
      expectedOutput: '42',
    }
    expect(formatRunOutput(entry)).toBe('42\n\n[exited with code 0]\n[assertion: passed]')
  })

  it('formats failed assertion with Expected vs Actual diff', () => {
    const entry: RunEntry = {
      runId: 'r1',
      status: 'exited',
      exitCode: 0,
      output: [{ stream: 'stdout', text: '43\n' }],
      expectedOutput: '42',
    }
    expect(formatRunOutput(entry)).toBe(
      'Expected:\n42\n\nActual:\n43\n\n[exited with code 0]\n[assertion: failed (output mismatch)]',
    )
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

describe('Expected output and assertion UI in editor', () => {
  it('shows a green Passed badge when stdout matches the expect block', async () => {
    useWorkspaceStore.getState().setActiveTab('note.md')
    mount(`${codeBlock('python', 'print(42)')}${codeBlock('expect', '42')}`)

    const run = editor!.view.dom.querySelector('.code-run-run')
    expect(run).not.toBeNull()
    run!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await vi.waitFor(() => expect(api.codeRun.run).toHaveBeenCalled())
    const runId = vi.mocked(api.codeRun.run).mock.calls[0]![0] as string

    listenCallbacks.get('code-run-output')?.({ payload: { runId, stream: 'stdout', data: btoa('42\n') } })
    listenCallbacks.get('code-run-exit')?.({ payload: { runId, code: 0 } })

    const badge = editor!.view.dom.querySelector('.code-run-assertion') as HTMLElement
    expect(badge.hidden).toBe(false)
    expect(badge.textContent).toBe('✓ Passed')
    expect(badge.classList.contains('pass')).toBe(true)
  })

  it('shows a red Failed badge and diff when stdout does not match the expect block', async () => {
    useWorkspaceStore.getState().setActiveTab('note.md')
    mount(`${codeBlock('python', 'print(99)')}${codeBlock('expect', '42')}`)

    const run = editor!.view.dom.querySelector('.code-run-run')
    expect(run).not.toBeNull()
    run!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await vi.waitFor(() => expect(api.codeRun.run).toHaveBeenCalled())
    const runId = vi.mocked(api.codeRun.run).mock.calls[0]![0] as string

    listenCallbacks.get('code-run-output')?.({ payload: { runId, stream: 'stdout', data: btoa('99\n') } })
    listenCallbacks.get('code-run-exit')?.({ payload: { runId, code: 0 } })

    const badge = editor!.view.dom.querySelector('.code-run-assertion') as HTMLElement
    expect(badge.hidden).toBe(false)
    expect(badge.textContent).toBe('✗ Failed')
    expect(badge.classList.contains('fail')).toBe(true)

    const output = editor!.view.dom.querySelector('.code-run-output') as HTMLElement
    expect(output.textContent).toContain('Expected:\n42')
    expect(output.textContent).toContain('Actual:\n99')
  })

  it('allows clicking Add expected to insert an expect code block', async () => {
    mount(codeBlock('python', 'print(5)'))
    const expectBtn = editor!.view.dom.querySelector('.code-run-expect') as HTMLElement
    expect(expectBtn).not.toBeNull()
    expect(expectBtn.hidden).toBe(false)

    expectBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const blocks: { lang: string; text: string }[] = []
    editor!.state.doc.descendants((node) => {
      if (node.type.name === 'codeBlock') {
        blocks.push({ lang: String(node.attrs['language'] ?? ''), text: node.textContent })
      }
      return true
    })
    expect(blocks).toEqual([
      { lang: 'python', text: 'print(5)' },
      { lang: 'expect', text: '' },
    ])
  })

  it('allows clicking Set as expected after run to insert an expect block with actual stdout', async () => {
    useWorkspaceStore.getState().setActiveTab('note.md')
    mount(codeBlock('python', 'print(123)'))

    const run = editor!.view.dom.querySelector('.code-run-run')
    run!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await vi.waitFor(() => expect(api.codeRun.run).toHaveBeenCalled())
    const runId = vi.mocked(api.codeRun.run).mock.calls[0]![0] as string

    listenCallbacks.get('code-run-output')?.({ payload: { runId, stream: 'stdout', data: btoa('123\n') } })
    listenCallbacks.get('code-run-exit')?.({ payload: { runId, code: 0 } })

    const expectBtn = editor!.view.dom.querySelector('.code-run-expect') as HTMLElement
    expect(expectBtn.hidden).toBe(false)
    expect(expectBtn.textContent).toBe('Set as expected')

    expectBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const blocks: { lang: string; text: string }[] = []
    editor!.state.doc.descendants((node) => {
      if (node.type.name === 'codeBlock') {
        blocks.push({ lang: String(node.attrs['language'] ?? ''), text: node.textContent })
      }
      return true
    })
    expect(blocks).toEqual([
      { lang: 'python', text: 'print(123)' },
      { lang: 'expect', text: '123' },
    ])
  })
})

describe('applyCodeRunMeta', () => {
  it('start creates a fresh entry at the given position', () => {
    const entries = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    expect(entries.get(5)).toEqual<RunEntry>({
      runId: 'r1',
      status: 'starting',
      exitCode: null,
      output: [],
      expectedOutput: null,
    })
  })

  it('start captures expectedOutput if provided', () => {
    const entries = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1', expectedOutput: '42' })
    expect(entries.get(5)).toEqual<RunEntry>({
      runId: 'r1',
      status: 'starting',
      exitCode: null,
      output: [],
      expectedOutput: '42',
    })
  })

  it('start replaces a prior entry at the same position', () => {
    const first = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const withOutput = applyCodeRunMeta(first, { type: 'output', runId: 'r1', stream: 'stdout', text: 'old\n' })

    const restarted = applyCodeRunMeta(withOutput, { type: 'start', pos: 5, runId: 'r2' })

    expect(restarted.get(5)).toEqual<RunEntry>({
      runId: 'r2',
      status: 'starting',
      exitCode: null,
      output: [],
      expectedOutput: null,
    })
  })

  it('output appends a chunk and flips status to running', () => {
    const started = applyCodeRunMeta(new Map(), { type: 'start', pos: 5, runId: 'r1' })
    const next = applyCodeRunMeta(started, { type: 'output', runId: 'r1', stream: 'stdout', text: 'hi\n' })

    expect(next.get(5)).toEqual<RunEntry>({
      runId: 'r1',
      status: 'running',
      exitCode: null,
      output: [{ stream: 'stdout', text: 'hi\n' }],
      expectedOutput: null,
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

    expect(next.get(5)).toEqual<RunEntry>({
      runId: 'r1',
      status: 'exited',
      exitCode: 2,
      output: [],
      expectedOutput: null,
    })
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

