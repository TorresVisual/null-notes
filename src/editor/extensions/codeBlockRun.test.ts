import { describe, it, expect } from 'vitest'
import { applyCodeRunMeta, decodeBase64Text } from './CodeBlockRun'
import type { RunEntry } from './CodeBlockRun'

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
