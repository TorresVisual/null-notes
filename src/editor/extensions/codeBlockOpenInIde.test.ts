import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import type { BacklinkEntry } from '../../types'

const resolveCodeLinks = vi.fn<(workspace: string, targets: string[]) => Promise<boolean[]>>()
const openInEditor = vi.fn()
const codeBacklinksForWithContext = vi.fn<
  (workspace: string, target: string) => Promise<BacklinkEntry[]>
>()

vi.mock('../../lib/tauri', () => ({
  api: {
    notes: {
      resolveCodeLinks: (workspace: string, targets: string[]) => resolveCodeLinks(workspace, targets),
      openInEditor: (...args: unknown[]) => openInEditor(...args),
      codeBacklinksForWithContext: (workspace: string, target: string) =>
        codeBacklinksForWithContext(workspace, target),
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

function buttons(e: InstanceType<typeof Editor>): HTMLElement[] {
  return [...e.view.dom.querySelectorAll('.code-block-open-in-ide')] as HTMLElement[]
}

function codeBlock(firstLine: string, language = 'rust'): string {
  return `<pre><code class="language-${language}">${firstLine}\nfn main() {}</code></pre>`
}

function backlinkEntry(path: string, title: string, snippet: string | null = null): BacklinkEntry {
  return { note: { id: path, title, path, workspace: '/ws', updatedAt: 0 }, snippet }
}

beforeEach(() => {
  forgetResolvedCodeLinks()
  resolveCodeLinks.mockReset()
  openInEditor.mockReset()
  codeBacklinksForWithContext.mockReset()
  codeBacklinksForWithContext.mockResolvedValue([])
  useWorkspaceStore.setState({ path: '/ws', openTabs: [], activeTab: null })
})

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('code block "Open in IDE"', () => {
  it('asks the backend about a path named on the block\'s first line', async () => {
    resolveCodeLinks.mockResolvedValue([true])
    mount(codeBlock('// src/main.rs'))

    await settle()

    expect(resolveCodeLinks).toHaveBeenCalledWith('/ws', ['src/main.rs'])
  })

  it('shows the button once the path resolves, and opens it on click', async () => {
    resolveCodeLinks.mockResolvedValue([true])
    const e = mount(codeBlock('// src/main.rs:12'))
    await settle()

    const [button] = buttons(e)
    expect(button).toBeDefined()

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(openInEditor).toHaveBeenCalledWith('/ws', 'src/main.rs', 12)
  })

  // The DoD: never a dead button. An unresolved path shows nothing to click,
  // unlike the inline CodeLink's "missing" styling.
  it('renders no button when the path does not resolve', async () => {
    resolveCodeLinks.mockResolvedValue([false])
    const e = mount(codeBlock('// src/gone.rs'))
    await settle()

    expect(buttons(e)).toHaveLength(0)
  })

  it('renders no button for a code block with no source-path annotation', async () => {
    resolveCodeLinks.mockResolvedValue([])
    const e = mount(codeBlock('let x = 1;'))
    await settle()

    expect(buttons(e)).toHaveLength(0)
    expect(resolveCodeLinks).not.toHaveBeenCalled()
  })

  it('decorates nothing when no workspace is open', async () => {
    useWorkspaceStore.setState({ path: null })
    const e = mount(codeBlock('// src/main.rs'))
    await settle()

    expect(buttons(e)).toHaveLength(0)
    expect(resolveCodeLinks).not.toHaveBeenCalled()
  })
})

describe('code block backlinks badge (issue #37)', () => {
  it('shows a badge for notes that reference the same path, and opens one on click', async () => {
    resolveCodeLinks.mockResolvedValue([true])
    codeBacklinksForWithContext.mockResolvedValue([backlinkEntry('/ws/a.md', 'A', 'see src/main.rs:1')])
    const e = mount(codeBlock('// src/main.rs'))
    await settle()

    const badge = e.view.dom.querySelector<HTMLElement>('.code-block-backlinks-badge')
    expect(badge?.textContent).toBe('1 note')

    badge?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(useWorkspaceStore.getState().activeTab).toBeNull()

    const item = e.view.dom.querySelector<HTMLElement>('.backlink-item')
    item?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/a.md')
  })

  it('excludes the current note itself from the badge', async () => {
    resolveCodeLinks.mockResolvedValue([true])
    codeBacklinksForWithContext.mockResolvedValue([backlinkEntry('/ws/self.md', 'Self')])
    const e = mount(codeBlock('// src/main.rs'))
    e.storage.noteContext.notePath = '/ws/self.md'
    await settle()

    expect(e.view.dom.querySelector('.code-block-backlinks-badge')).toBeNull()
  })

  it('renders no badge when no other note references the path', async () => {
    resolveCodeLinks.mockResolvedValue([true])
    codeBacklinksForWithContext.mockResolvedValue([])
    const e = mount(codeBlock('// src/main.rs'))
    await settle()

    expect(e.view.dom.querySelector('.code-block-backlinks-badge')).toBeNull()
  })
})
