import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { platform } from '@tauri-apps/plugin-os'
import { useKeepCaretVisible, caretScrollProps } from './useKeepCaretVisible'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))

function fakeEditor(isFocused: boolean) {
  const scrollIntoView = vi.fn()
  return { editor: { isFocused, commands: { scrollIntoView } } as unknown as Editor, scrollIntoView }
}

beforeEach(() => vi.mocked(platform).mockReturnValue('android'))

describe('useKeepCaretVisible', () => {
  it('scrolls the caret into view when the viewport resizes while focused', () => {
    const { editor, scrollIntoView } = fakeEditor(true)
    renderHook(() => useKeepCaretVisible(editor))
    window.dispatchEvent(new Event('resize'))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the editor is not focused', () => {
    const { editor, scrollIntoView } = fakeEditor(false)
    renderHook(() => useKeepCaretVisible(editor))
    window.dispatchEvent(new Event('resize'))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does nothing on desktop', () => {
    vi.mocked(platform).mockReturnValue('windows')
    const { editor, scrollIntoView } = fakeEditor(true)
    renderHook(() => useKeepCaretVisible(editor))
    window.dispatchEvent(new Event('resize'))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('stops listening after unmount', () => {
    const { editor, scrollIntoView } = fakeEditor(true)
    renderHook(() => useKeepCaretVisible(editor)).unmount()
    window.dispatchEvent(new Event('resize'))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('caretScrollProps', () => {
  it('keeps the caret clear of the bottom-pinned toolbar on mobile', () => {
    const { scrollMargin, scrollThreshold } = caretScrollProps(true)
    expect(scrollMargin?.bottom).toBeGreaterThanOrEqual(64)
    expect(scrollThreshold?.bottom).toBeGreaterThanOrEqual(64)
  })

  it('adds nothing on desktop', () => {
    expect(caretScrollProps(false)).toEqual({})
  })
})
