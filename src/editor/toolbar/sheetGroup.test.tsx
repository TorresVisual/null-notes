import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'

const splitIntoTasks = vi.fn<(editor: unknown) => Promise<'split' | 'no-structure'>>()
splitIntoTasks.mockResolvedValue('split')
const addNextTask = vi.fn<(editor: unknown, label: string) => Promise<void>>()
addNextTask.mockResolvedValue(undefined)
vi.mock('../splitIntoTasks', () => ({
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

describe('the exercise sheet group', () => {
  it('runs Split Into Tasks', async () => {
    const { getByLabelText } = mount('<p>1. Erste</p>')

    fireEvent.click(getByLabelText('Split into tasks'))

    await waitFor(() => expect(splitIntoTasks).toHaveBeenCalledTimes(1))
  })

  it('appends the next task', async () => {
    const { getByLabelText } = mount('<h2>Task 1</h2><h3>Solution</h3>')

    fireEvent.click(getByLabelText('Add next task'))

    await waitFor(() => expect(addNextTask).toHaveBeenCalledTimes(1))
  })

  it('passes the next label, counted from the note', async () => {
    const { getByLabelText } = mount('<h2>Task 3</h2><h3>Solution</h3>')

    fireEvent.click(getByLabelText('Add next task'))

    await waitFor(() => expect(addNextTask.mock.calls[0]?.[1]).toBe('4'))
  })
})
