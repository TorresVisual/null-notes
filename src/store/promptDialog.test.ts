import { describe, it, expect, afterEach } from 'vitest'
import { usePromptDialogStore, promptText } from './promptDialog'

afterEach(() => {
  usePromptDialogStore.setState({ open: false, message: '', defaultValue: '', resolve: null })
})

describe('promptDialog store', () => {
  it('opens with the given message and default value', () => {
    void promptText('New title:', 'Lecture 7')

    const state = usePromptDialogStore.getState()
    expect(state.open).toBe(true)
    expect(state.message).toBe('New title:')
    expect(state.defaultValue).toBe('Lecture 7')
  })

  it('resolves with the submitted value and closes', async () => {
    const result = promptText('Note title:')
    usePromptDialogStore.getState().submit('Lecture 8')

    expect(await result).toBe('Lecture 8')
    expect(usePromptDialogStore.getState().open).toBe(false)
  })

  it('resolves with null on cancel', async () => {
    const result = promptText('Note title:')
    usePromptDialogStore.getState().cancel()

    expect(await result).toBeNull()
    expect(usePromptDialogStore.getState().open).toBe(false)
  })

  // Dialogs are modal in practice, so a second request while one is already
  // pending shouldn't happen — but if it ever does, the first caller's
  // promise must still settle rather than hang forever.
  it('cancels a still-pending prompt when a new one is requested', async () => {
    const first = promptText('First:')
    const second = promptText('Second:')

    expect(await first).toBeNull()
    usePromptDialogStore.getState().submit('answer')
    expect(await second).toBe('answer')
  })
})
