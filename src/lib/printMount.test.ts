import { describe, it, expect, vi, afterEach } from 'vitest'
import { withPrintMount } from './printMount'

const previewMock = vi.hoisted(() => vi.fn())

vi.mock('pagedjs', () => ({
  Previewer: vi.fn().mockImplementation(function MockPreviewer() {
    return {
      preview: previewMock,
      chunker: { stop: vi.fn(), removePages: vi.fn() },
      polisher: { destroy: vi.fn() },
    }
  }),
}))

afterEach(() => vi.clearAllMocks())

describe('withPrintMount', () => {
  it('shows #print-root and body.printing only while the job runs', async () => {
    previewMock.mockResolvedValue({ total: 1 })
    let during: { mount: boolean; printing: boolean } | undefined

    await withPrintMount(document.createElement('div'), '@page {}', async () => {
      during = {
        mount: document.getElementById('print-root') !== null,
        printing: document.body.classList.contains('printing'),
      }
    })

    expect(during).toEqual({ mount: true, printing: true })
    expect(document.getElementById('print-root')).toBeNull()
    expect(document.body.classList.contains('printing')).toBe(false)
  })

  it('cleans up when the job fails', async () => {
    previewMock.mockResolvedValue({ total: 1 })

    await expect(
      withPrintMount(document.createElement('div'), '@page {}', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom')

    expect(document.getElementById('print-root')).toBeNull()
    expect(document.body.classList.contains('printing')).toBe(false)
  })

  it('cleans up when pagination fails, without running the job', async () => {
    previewMock.mockRejectedValue(new Error('paged.js exploded'))
    const run = vi.fn()

    await expect(withPrintMount(document.createElement('div'), '@page {}', run)).rejects.toThrow('paged.js exploded')

    expect(run).not.toHaveBeenCalled()
    expect(document.getElementById('print-root')).toBeNull()
  })
})
