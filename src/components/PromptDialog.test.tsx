import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptDialog } from './PromptDialog'
import { promptText, usePromptDialogStore } from '../store/promptDialog'

afterEach(() => {
  cleanup()
  usePromptDialogStore.setState({ open: false, message: '', defaultValue: '', resolve: null })
})

describe('PromptDialog', () => {
  it('renders nothing until a prompt is requested', () => {
    render(<PromptDialog />)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows the message and pre-fills the default value', async () => {
    render(<PromptDialog />)
    void promptText('New title:', 'Lecture 7')

    expect(await screen.findByText('New title:')).toBeInTheDocument()
    expect(await screen.findByRole('textbox')).toHaveValue('Lecture 7')
  })

  it('resolves with the typed value on submit', async () => {
    const user = userEvent.setup()
    render(<PromptDialog />)
    const result = promptText('Note title:')

    await user.type(await screen.findByRole('textbox'), 'Lecture 8')
    await user.click(screen.getByRole('button', { name: 'OK' }))

    expect(await result).toBe('Lecture 8')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('resolves with null on Cancel', async () => {
    const user = userEvent.setup()
    render(<PromptDialog />)
    const result = promptText('Note title:')

    await screen.findByRole('textbox')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await result).toBeNull()
  })

  it('resolves with null on Escape', async () => {
    const user = userEvent.setup()
    render(<PromptDialog />)
    const result = promptText('Note title:')

    await user.type(await screen.findByRole('textbox'), '{Escape}')

    expect(await result).toBeNull()
  })

  it('does not submit an empty value', async () => {
    const user = userEvent.setup()
    render(<PromptDialog />)
    promptText('Note title:', 'x')
    await user.clear(await screen.findByRole('textbox'))

    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
  })
})
