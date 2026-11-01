import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const splitIntoTasks = vi.fn<(editor: unknown) => Promise<'split' | 'no-structure'>>()
splitIntoTasks.mockResolvedValue('split')
const addNextTask = vi.fn<(editor: unknown, label: string) => Promise<void>>()
addNextTask.mockResolvedValue(undefined)
vi.mock('../splitIntoTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../splitIntoTasks')>()),
  splitIntoTasks: (editor: unknown) => splitIntoTasks(editor),
  addNextTask: (editor: unknown, label: string) => addNextTask(editor, label),
  report: () => {},
}))

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('../extensions')
const { SheetGroup } = await import('./SheetGroup')

let editor: InstanceType<typeof Editor> | null = null

function mount(content: string) {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return render(<SheetGroup editor={editor} />)
}

afterEach(() => {
  editor?.destroy()
  editor = null
  splitIntoTasks.mockClear()
  addNextTask.mockClear()
  cleanup()
})

async function choose(view: ReturnType<typeof render>, item: string) {
  const user = userEvent.setup()
  await user.click(view.getByLabelText('Exercise sheet', { selector: 'button' }))
  await user.click(await view.findByRole('menuitem', { name: item }))
}

describe('the exercise sheet group', () => {
  it('runs Split Into Tasks', async () => {
    const view = mount('<p>1. Erste</p>')

    await choose(view, 'Split into tasks')

    await waitFor(() => expect(splitIntoTasks).toHaveBeenCalledTimes(1))
  })

  it('appends the next task', async () => {
    const view = mount('<h2>Task 1</h2><h3>Solution</h3>')

    await choose(view, 'Add next task')

    await waitFor(() => expect(addNextTask).toHaveBeenCalledTimes(1))
  })

  it('passes the next label, counted from the note', async () => {
    const view = mount('<h2>Task 3</h2><h3>Solution</h3>')

    await choose(view, 'Add next task')

    await waitFor(() => expect(addNextTask.mock.calls[0]?.[1]).toBe('4'))
  })
})
