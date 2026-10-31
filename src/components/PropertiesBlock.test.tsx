import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PropertiesBlock } from './PropertiesBlock'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: { properties: { parse: vi.fn(), edit: vi.fn() } },
}))

const parse = vi.mocked(api.properties.parse)
const edit = vi.mocked(api.properties.edit)

beforeEach(() => {
  parse.mockReset()
  edit.mockReset()
})

describe('PropertiesBlock', () => {
  it('shows the parse error and no inputs when the frontmatter is invalid', async () => {
    parse.mockResolvedValue({ properties: {}, error: 'bad yaml at line 2' })

    render(<PropertiesBlock content={'---\na: [\n---\nbody'} onSave={vi.fn()} />)

    expect(await screen.findByText(/bad yaml at line 2/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add property/i })).not.toBeInTheDocument()
  })

  it('saves the edited content when a checkbox is toggled', async () => {
    const user = userEvent.setup()
    const content = '---\ndone: false\n---\nbody'
    parse.mockResolvedValue({ properties: { done: false }, error: null })
    edit.mockResolvedValue('---\ndone: true\n---\nbody')
    const onSave = vi.fn()

    render(<PropertiesBlock content={content} onSave={onSave} />)
    await user.click(await screen.findByRole('checkbox', { name: 'done' }))

    expect(edit).toHaveBeenCalledWith(content, { type: 'set', key: 'done', value: true })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('---\ndone: true\n---\nbody'))
  })

  it('offers only "Add property" for a note without frontmatter, and does not parse', () => {
    render(<PropertiesBlock content={'# Just a note'} onSave={vi.fn()} />)

    expect(screen.getByRole('button', { name: /add property/i })).toBeInTheDocument()
    expect(parse).not.toHaveBeenCalled()
  })

  it('adds a property from the key input', async () => {
    const user = userEvent.setup()
    edit.mockResolvedValue('---\nstatus: ""\n---\n# Just a note')
    const onSave = vi.fn()

    render(<PropertiesBlock content={'# Just a note'} onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: /add property/i }))
    await user.type(screen.getByRole('textbox', { name: 'New property name' }), 'status{Enter}')

    expect(edit).toHaveBeenCalledWith('# Just a note', { type: 'set', key: 'status', value: '' })
    await waitFor(() => expect(onSave).toHaveBeenCalled())
  })

  it('removes a property', async () => {
    const user = userEvent.setup()
    const content = '---\nstatus: todo\n---\nbody'
    parse.mockResolvedValue({ properties: { status: 'todo' }, error: null })
    edit.mockResolvedValue('body')

    render(<PropertiesBlock content={content} onSave={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Remove status' }))

    expect(edit).toHaveBeenCalledWith(content, { type: 'remove', key: 'status' })
  })

  it('commits a text edit on blur only when the value changed', async () => {
    const user = userEvent.setup()
    const content = '---\nstatus: todo\n---\nbody'
    parse.mockResolvedValue({ properties: { status: 'todo' }, error: null })
    edit.mockResolvedValue('---\nstatus: done\n---\nbody')

    render(<PropertiesBlock content={content} onSave={vi.fn()} />)
    const input = await screen.findByRole('textbox', { name: 'status' })
    await user.click(input)
    await user.tab()
    expect(edit).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, 'done')
    await user.tab()
    expect(edit).toHaveBeenCalledWith(content, { type: 'set', key: 'status', value: 'done' })
  })
})
