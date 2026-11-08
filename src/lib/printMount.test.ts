import { describe, it, expect, vi, afterEach } from 'vitest'
import { adaptInkForPrint, markPageBreaks, withPrintMount } from './printMount'

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

describe('markPageBreaks', () => {
  function build(html: string): HTMLElement {
    const root = document.createElement('div')
    // Test-only helper; callers always pass this file's own hardcoded fixture strings.
    // eslint-disable-next-line no-unsanitized/property
    root.innerHTML = html
    return root
  }

  it('keeps a heading and a code-block caption with the node after them', () => {
    const root = build('<h2>Title</h2><p>intro</p><p>Caption.java</p><pre>a</pre>')
    markPageBreaks(root)

    const at = (i: number) => root.children.item(i)
    expect(at(0)?.getAttribute('data-break-after')).toBe('avoid')
    expect(at(1)?.getAttribute('data-previous-break-after')).toBe('avoid')
    expect(at(1)?.hasAttribute('data-break-after')).toBe(false)
    expect(at(2)?.getAttribute('data-break-after')).toBe('avoid')
    expect(at(3)?.getAttribute('data-previous-break-after')).toBe('avoid')
  })

  it('makes whitespace-only text in code blocks non-whitespace so Paged.js keeps it', () => {
    const root = build('<pre><span>private</span> <span>double</span>\n    <span>x</span> y</pre>')
    markPageBreaks(root)

    const texts = Array.from(root.querySelector('pre')?.childNodes ?? []).map((n) => n.textContent)
    expect(texts).toEqual(['private', ' ​', 'double', '\n    ​', 'x', ' y'])
  })

  it('keeps short code blocks together and lets long ones split', () => {
    const short = '<pre>' + 'x\n'.repeat(7) + 'x</pre>'
    const long = '<pre>' + 'x\n'.repeat(8) + 'x</pre>'
    const root = build(short + long)
    markPageBreaks(root)

    expect(root.children.item(0)?.hasAttribute('data-keep-together')).toBe(true)
    expect(root.children.item(1)?.hasAttribute('data-keep-together')).toBe(false)
  })
})

describe('adaptInkForPrint', () => {
  it('darkens light ink, keeps hue, leaves dark and none alone', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<div class="ink-preview-page"><svg><path fill="#e6edf3"/><path fill="#ff7b72"/><path fill="#111111"/><path fill="none" stroke="#fff"/></svg></div>'
    adaptInkForPrint(root)
    const fills = Array.from(root.querySelectorAll('path'), (el) => el.getAttribute('fill'))
    const stroke = root.querySelectorAll('path')[3]?.getAttribute('stroke')
    expect(fills[0]).toBe('#0c1319')
    expect(fills[1]).toBe('#8d0900')
    expect(fills[2]).toBe('#111111')
    expect(fills[3]).toBe('none')
    expect(stroke).toBe('#000000')
  })
})
