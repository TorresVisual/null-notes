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

function buttons(e: InstanceType<typeof Editor>): HTMLElement[] {
  return [...e.view.dom.querySelectorAll('.code-block-open-in-ide')] as HTMLElement[]
}

function codeBlock(firstLine: string, language = 'rust'): string {
  return `<pre><code class="language-${language}">${firstLine}\nfn main() {}</code></pre>`
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

    expect(openInEditor).toHaveBeenCalledWith('/ws', 'src/main.rs', 12, expect.any(String))
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
