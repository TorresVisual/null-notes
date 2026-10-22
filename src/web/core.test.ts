import { describe, expect, it } from 'vitest'
import { invoke } from './core'

describe('web invoke', () => {
  it('round-trips a created note through the in-memory workspace', async () => {
    await invoke('create_note', { workspace: '/demo', folder: '/demo', title: 'Scratch' })
    await invoke('save_note', { workspace: '/demo', path: '/demo/Scratch.md', content: 'hi' })
    expect(await invoke('open_note', { workspace: '/demo', path: '/demo/Scratch.md' })).toBe('hi')
  })

  it('rejects commands the web app does not implement', async () => {
    await expect(invoke('run_code')).rejects.toThrow('not available in the web app')
  })
})
