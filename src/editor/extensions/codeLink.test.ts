import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'

const resolveCodeLinks = vi.fn<(workspace: string, targets: string[]) => Promise<boolean[]>>()
const openInEditor = vi.fn()

vi.mock('../../lib/tauri', () => ({
  api: {
    notes: {
      resolveCodeLinks: (workspace: string, targets: string[]) => resolveCodeLinks(workspace, targets),
      openInEditor: (...args: unknown[]) => openInEditor(...args),
    },
  },
}))

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./index')
const { forgetResolvedCodeLinks } = await import('./CodeLink')
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

function links(e: InstanceType<typeof Editor>): HTMLElement[] {
  return [...e.view.dom.querySelectorAll('.code-link')] as HTMLElement[]
}

beforeEach(() => {
  forgetResolvedCodeLinks()
  resolveCodeLinks.mockReset()
  openInEditor.mockReset()
  useWorkspaceStore.setState({ path: '/ws' })
})

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('code deep links', () => {
  it('asks the backend about the targets it finds, batched', async () => {
    resolveCodeLinks.mockResolvedValue([true, true])
    const e = mount('<p>see src/main.rs:58 and docs/plan.md</p>')

    await settle()

    expect(resolveCodeLinks).toHaveBeenCalledTimes(1)
    expect(resolveCodeLinks.mock.calls[0]?.[1]).toEqual(['src/main.rs', 'docs/plan.md'])
  })

  it('marks a resolved link clickable and opens it at its line', async () => {
    resolveCodeLinks.mockResolvedValue([true])
    const e = mount('<p>see src/main.rs:58 here</p>')
    await settle()

    const [link] = links(e)
    expect(link?.classList.contains('code-link-missing')).toBe(false)

    link?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(openInEditor).toHaveBeenCalledWith('/ws', 'src/main.rs', 58, expect.any(String))
  })

  // The safety property: an unresolved link says what it points at and does
  // nothing — the same answer an unresolved wiki-link already gives.
  it('leaves an unresolved link inert', async () => {
    resolveCodeLinks.mockResolvedValue([false])
    const e = mount('<p>see src/gone.rs:12 here</p>')
    await settle()

    const [link] = links(e)
    expect(link?.classList.contains('code-link-missing')).toBe(true)

    link?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(openInEditor).not.toHaveBeenCalled()
  })

  // A lookup that fails must not fail open. Unknown means inert, never a
  // launch on a path nothing confirmed.
  it('treats a failed lookup as unresolved', async () => {
    resolveCodeLinks.mockRejectedValue(new Error('backend down'))
    const e = mount('<p>see src/main.rs:58 here</p>')
    await settle()

    links(e)[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(openInEditor).not.toHaveBeenCalled()
  })

  it('decorates nothing when no workspace is open', async () => {
    useWorkspaceStore.setState({ path: null })
    const e = mount('<p>see src/main.rs:58 here</p>')
    await settle()

    expect(links(e)).toHaveLength(0)
    expect(resolveCodeLinks).not.toHaveBeenCalled()
  })
})
