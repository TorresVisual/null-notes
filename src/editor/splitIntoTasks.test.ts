import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

const splitIntoTasksIpc = vi.fn<(markdown: string) => Promise<string>>()
const ensureDir = vi.fn<(notePath: string) => Promise<string>>()
const writeInk = vi.fn<(path: string, data: unknown) => Promise<void>>()

vi.mock('../lib/tauri', () => ({
  api: { notes: { splitIntoTasks: (md: string) => splitIntoTasksIpc(md) } },
}))
vi.mock('../lib/ink', () => ({
  inkApi: {
    ensureDir: (p: string) => ensureDir(p),
    write: (p: string, d: unknown) => writeInk(p, d),
  },
}))
// report() calls this on a failure — including the ink-sidecar failure some
// of these tests exercise deliberately — and there is no Tauri IPC bridge in
// this jsdom environment to answer it.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
  message: vi.fn(),
}))

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./extensions')
const { splitIntoTasks, addNextTask } = await import('./splitIntoTasks')

let editor: InstanceType<typeof Editor> | null = null

function mount(content: string) {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  editor.storage.noteContext.notePath = '/ws/Blatt 12.md'
  return editor
}

function markdownOf(e: InstanceType<typeof Editor>): string {
  const storage = e.storage as unknown as { markdown: { getMarkdown: () => string } }
  return storage.markdown.getMarkdown()
}

function inkNodes(e: InstanceType<typeof Editor>): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = []
  e.state.doc.descendants((node) => {
    if (node.type.name === 'inkBlock') found.push(node.attrs)
    return true
  })
  return found
}

beforeEach(() => {
  splitIntoTasksIpc.mockReset()
  ensureDir.mockReset().mockResolvedValue('/ws/Blatt 12.ink')
  writeInk.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  editor?.destroy()
  editor = null
})

// The point of the whole workflow: solutions are handwritten. A scaffold of
// empty headings leaves you inserting ink once per exercise by hand.
describe('splitting a sheet into tasks', () => {
  it('leaves a handwriting canvas under every solution', async () => {
    const e = mount('<p>1. Erste Aufgabe</p><p>2. Zweite Aufgabe</p>')
    splitIntoTasksIpc.mockResolvedValue(
      '## Task 1\n\n1. Erste Aufgabe\n\n### Solution\n\n## Task 2\n\n2. Zweite Aufgabe\n\n### Solution\n',
    )

    const outcome = await splitIntoTasks(e)

    expect(outcome).toBe('split')
    expect(inkNodes(e)).toHaveLength(2)
    expect(markdownOf(e)).toContain('### Solution')
  })

  // One sidecar SVG per canvas, written before the document is rewritten, so a
  // failure leaves the note alone rather than pointing blocks at missing files.
  it('creates one ink sidecar per solution, beside the note', async () => {
    const e = mount('<p>1. Erste</p>')
    splitIntoTasksIpc.mockResolvedValue('## Task 1\n\n1. Erste\n\n### Solution\n\n## Task 2\n\n### Solution\n')

    await splitIntoTasks(e)

    expect(ensureDir).toHaveBeenCalledWith('/ws/Blatt 12.md')
    expect(writeInk).toHaveBeenCalledTimes(2)
    const paths = writeInk.mock.calls.map((call) => call[0])
    expect(new Set(paths).size).toBe(2)
    paths.forEach((path) => expect(path.startsWith('/ws/Blatt 12.ink/')).toBe(true))
  })

  it('starts each canvas short, since it grows as you write', async () => {
    const e = mount('<p>1. Erste</p>')
    splitIntoTasksIpc.mockResolvedValue('## Task 1\n\n### Solution\n')

    await splitIntoTasks(e)

    expect(inkNodes(e)[0]?.['height']).toBe(400)
  })

  // Reported from real use: the split did nothing, but a NoteName.ink/ folder
  // appeared beside the note anyway — which reads as the command having
  // half-run on a note it did not touch.
  it('creates no ink sidecar when there is nothing to put a canvas under', async () => {
    const e = mount('<p>1. Erste</p>')
    splitIntoTasksIpc.mockResolvedValue('## Task 1\n\n1. Erste\n\n### Solution\n\nalready answered\n')

    await splitIntoTasks(e)

    expect(ensureDir).not.toHaveBeenCalled()
    expect(writeInk).not.toHaveBeenCalled()
  })

  // Both entry points used to fire this as a bare `void promise.then(...)`, so
  // a backend that had not been rebuilt — and therefore did not carry the
  // command at all — produced no message, no change, and no clue. The failure
  // has to reach the caller.
  it('rejects rather than swallowing a backend failure', async () => {
    const e = mount('<p>1. Erste</p>')
    splitIntoTasksIpc.mockRejectedValue(new Error('command split_into_tasks not found'))

    await expect(splitIntoTasks(e)).rejects.toThrow('not found')
  })

  // "It worked before we added ink support" — because before, nothing between
  // the split and the rewrite could fail. The split is the deliverable and the
  // canvases are an addition to it, so a sidecar that cannot be written costs
  // the canvases and not the whole rewrite.
  it('still splits the note when the canvases cannot be created', async () => {
    const e = mount('<p>1. Erste</p>')
    splitIntoTasksIpc.mockResolvedValue('## Task 1\n\n1. Erste\n\n### Solution\n\n## Task 2\n\n### Solution\n')
    ensureDir.mockRejectedValue(new Error('permission denied'))

    const outcome = await splitIntoTasks(e)

    expect(outcome).toBe('split')
    expect(markdownOf(e)).toContain('## Task 2')
    expect(inkNodes(e)).toHaveLength(0)
  })

  it('still splits when the note has no path to hang a sidecar off', async () => {
    const e = mount('<p>1. Erste</p>')
    e.storage.noteContext.notePath = ''
    splitIntoTasksIpc.mockResolvedValue('## Task 1\n\n1. Erste\n\n### Solution\n\n## Task 2\n\n### Solution\n')

    expect(await splitIntoTasks(e)).toBe('split')
    expect(markdownOf(e)).toContain('## Task 2')
  })

  it('reports no-structure and changes nothing when the splitter found none', async () => {
    const e = mount('<p>ordinary prose</p>')
    splitIntoTasksIpc.mockImplementation((md) => Promise.resolve(md))
    const before = markdownOf(e)

    const outcome = await splitIntoTasks(e)

    expect(outcome).toBe('no-structure')
    expect(markdownOf(e)).toBe(before)
    expect(writeInk).not.toHaveBeenCalled()
  })
})

describe('add next task', () => {
  it('appends a task whose solution already has a canvas', async () => {
    const e = mount('<h2>Task 1</h2><h3>Solution</h3>')

    await addNextTask(e, '2')

    const md = markdownOf(e)
    expect(md).toContain('## Task 2')
    expect(inkNodes(e)).toHaveLength(1)
  })
})
