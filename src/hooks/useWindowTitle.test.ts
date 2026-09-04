import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useWindowTitle } from './useWindowTitle'

const setTitle = vi.fn()
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setTitle }),
}))

afterEach(() => {
  cleanup()
  setTitle.mockClear()
})

describe('useWindowTitle', () => {
  it('shows just the app name with no workspace or note open', () => {
    renderHook(() => useWindowTitle(null, null))
    expect(setTitle).toHaveBeenCalledWith('null-notes')
  })

  it('prefixes the workspace folder name once a workspace is open', () => {
    renderHook(() => useWindowTitle('C:\\Users\\me\\Notes', null))
    expect(setTitle).toHaveBeenCalledWith('Notes — null-notes')
  })

  it('leads with the note name, stripped of .md, when a note is active', () => {
    renderHook(() => useWindowTitle('C:\\Users\\me\\Notes', 'C:\\Users\\me\\Notes\\Lecture 7.md'))
    expect(setTitle).toHaveBeenCalledWith('Lecture 7 — Notes — null-notes')
  })
})
