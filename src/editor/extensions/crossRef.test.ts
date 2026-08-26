import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'

const resolveCrossRefs =
  vi.fn<(workspace: string, targets: { calloutType: string; number: string }[]) => Promise<(string | null)[]>>()

vi.mock('../../lib/tauri', () => ({
  api: {
    notes: {
      resolveCrossRefs: (workspace: string, targets: { calloutType: string; number: string }[]) =>
        resolveCrossRefs(workspace, targets),
    },
  },
}))

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./index')
const { forgetResolvedCrossRefs } = await import('./CrossRef')
const { useWorkspaceStore } = await import('../../store/workspace')

let editor: InstanceType<typeof Editor> | null = null

function mount(content: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content })
  return editor
}

/** Lets the batched resolve call and its redraw land. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function refs(e: InstanceType<typeof Editor>): HTMLElement[] {
  return [...e.view.dom.querySelectorAll('.cross-ref')] as HTMLElement[]
}

beforeEach(() => {
  forgetResolvedCrossRefs()
  resolveCrossRefs.mockReset()
  useWorkspaceStore.setState({ path: '/ws', openTabs: [], activeTab: null })
  // The click handler's scroll-retry loop would otherwise keep scheduling
  // itself for up to 90 frames looking for a block this test never renders.
  vi.stubGlobal('requestAnimationFrame', () => 0)
})

afterEach(() => {
  editor?.destroy()
  editor = null
  vi.unstubAllGlobals()
})

describe('cross-references', () => {
  it('asks the backend about the references it finds, batched', async () => {
    resolveCrossRefs.mockResolvedValue(['/ws/a.md', null])
    mount('<p>See Theorem 3.2 and Lemma 5</p>')

    await settle()

    expect(resolveCrossRefs).toHaveBeenCalledTimes(1)
    expect(resolveCrossRefs.mock.calls[0]?.[1]).toEqual([
      { calloutType: 'theorem', number: '3.2' },
      { calloutType: 'lemma', number: '5' },
    ])
  })

  it('marks a resolved reference clickable and jumps to its note', async () => {
    resolveCrossRefs.mockResolvedValue(['/ws/analysis.md'])
    const e = mount('<p>See Theorem 3.2 for details</p>')
    await settle()

    const [ref] = refs(e)
    expect(ref?.classList.contains('cross-ref-missing')).toBe(false)

    ref?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/analysis.md')
  })

  // The safety property: an unresolved reference says what it points at and
  // does nothing — the same answer an unresolved wiki-link or code link
  // already gives.
  it('leaves an unresolved reference inert', async () => {
    resolveCrossRefs.mockResolvedValue([null])
    const e = mount('<p>See Theorem 9.9 for details</p>')
    await settle()

    const [ref] = refs(e)
    expect(ref?.classList.contains('cross-ref-missing')).toBe(true)

    ref?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(useWorkspaceStore.getState().activeTab).toBeNull()
  })

  // A lookup that fails must not fail open.
  it('treats a failed lookup as unresolved', async () => {
    resolveCrossRefs.mockRejectedValue(new Error('backend down'))
    const e = mount('<p>See Theorem 3.2 for details</p>')
    await settle()

    refs(e)[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(useWorkspaceStore.getState().activeTab).toBeNull()
  })

  it('decorates nothing when no workspace is open', async () => {
    useWorkspaceStore.setState({ path: null })
    const e = mount('<p>See Theorem 3.2 for details</p>')
    await settle()

    expect(refs(e)).toHaveLength(0)
    expect(resolveCrossRefs).not.toHaveBeenCalled()
  })

  it('does not decorate a plain wiki-link to a theorem note', async () => {
    const e = mount('<p>[[Theorem: Squeeze Theorem]]</p>')
    await settle()

    expect(refs(e)).toHaveLength(0)
  })
})

// P12-2: `Equation (3)` resolves against a numbered `BlockMath`, not a
// `Callout` — same decoration/resolution plumbing, a different backend
// target and a different DOM selector for the scroll-to-block jump.
describe('cross-references: equations (P12-2)', () => {
  it('recognizes both the parenthesized and bare number forms as calloutType "equation"', async () => {
    resolveCrossRefs.mockResolvedValue(['/ws/physics.md', '/ws/physics.md'])
    mount('<p>See Equation (3) and also Equation 5</p>')

    await settle()

    expect(resolveCrossRefs.mock.calls[0]?.[1]).toEqual([
      { calloutType: 'equation', number: '3' },
      { calloutType: 'equation', number: '5' },
    ])
  })

  it('jumps to the numbered block-math element, not a .callout selector', async () => {
    resolveCrossRefs.mockResolvedValue(['/ws/physics.md'])
    const e = mount('<p>See Equation (3) for the derivation</p>')
    await settle()

    // A plain DOM node outside the ProseMirror tree, standing in for the
    // real BlockMath render: mounting `<div class="block-math">` as editor
    // *content* wouldn't work, since it matches no node's parseHTML rule
    // and would just be dropped by the document parser.
    const target = document.createElement('div')
    target.className = 'block-math'
    target.setAttribute('data-number', '3')
    document.body.appendChild(target)

    const [ref] = refs(e)
    ref?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/physics.md')
    expect(target.classList.contains('cross-ref-target')).toBe(true)

    target.remove()
  })

  it('leaves an unresolved equation reference inert', async () => {
    resolveCrossRefs.mockResolvedValue([null])
    const e = mount('<p>See Equation (9) for details</p>')
    await settle()

    const [ref] = refs(e)
    expect(ref?.classList.contains('cross-ref-missing')).toBe(true)

    ref?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(useWorkspaceStore.getState().activeTab).toBeNull()
  })
})
