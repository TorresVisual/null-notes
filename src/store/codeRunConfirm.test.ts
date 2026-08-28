import { describe, it, expect, vi, beforeEach } from 'vitest'
import { confirm } from '@tauri-apps/plugin-dialog'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
}))

const { useCodeRunConfirmStore } = await import('./codeRunConfirm')
const dialog = vi.mocked({ confirm })

beforeEach(() => {
  useCodeRunConfirmStore.setState({ confirmedNotes: new Set() })
  dialog.confirm.mockReset()
})

describe('useCodeRunConfirmStore', () => {
  it('asks for confirmation the first time a note runs code', async () => {
    dialog.confirm.mockResolvedValue(true)

    const allowed = await useCodeRunConfirmStore.getState().confirmNote('/ws/a.md')

    expect(allowed).toBe(true)
    expect(dialog.confirm).toHaveBeenCalledTimes(1)
  })

  it('does not ask again for the same note once confirmed', async () => {
    dialog.confirm.mockResolvedValue(true)

    await useCodeRunConfirmStore.getState().confirmNote('/ws/a.md')
    const allowed = await useCodeRunConfirmStore.getState().confirmNote('/ws/a.md')

    expect(allowed).toBe(true)
    expect(dialog.confirm).toHaveBeenCalledTimes(1)
  })

  it('asks again for a different note', async () => {
    dialog.confirm.mockResolvedValue(true)

    await useCodeRunConfirmStore.getState().confirmNote('/ws/a.md')
    await useCodeRunConfirmStore.getState().confirmNote('/ws/b.md')

    expect(dialog.confirm).toHaveBeenCalledTimes(2)
  })

  it('does not remember a declined confirmation', async () => {
    dialog.confirm.mockResolvedValue(false)

    const first = await useCodeRunConfirmStore.getState().confirmNote('/ws/a.md')
    const second = await useCodeRunConfirmStore.getState().confirmNote('/ws/a.md')

    expect(first).toBe(false)
    expect(second).toBe(false)
    expect(dialog.confirm).toHaveBeenCalledTimes(2)
  })
})
