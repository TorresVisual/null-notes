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
