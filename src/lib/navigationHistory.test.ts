import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore } from '../store/workspace'
import { recordJumpFromHere, goBack, goForward, canGoBack, canGoForward, clearNavigationHistory } from './navigationHistory'

function mountScrollContainer(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'editor-scroll'
  document.body.appendChild(el)
  return el
}

beforeEach(() => {
  clearNavigationHistory()
  useWorkspaceStore.setState({ openTabs: [], activeTab: null })
  document.body.innerHTML = ''
})

describe('navigationHistory', () => {
  it('starts with nothing to go back or forward to', () => {
    expect(canGoBack()).toBe(false)
    expect(canGoForward()).toBe(false)
  })

  it('recordJumpFromHere pushes the current note onto the back stack', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    recordJumpFromHere()
    expect(canGoBack()).toBe(true)
  })

  it('recordJumpFromHere does nothing when there is no active tab', () => {
    recordJumpFromHere()
    expect(canGoBack()).toBe(false)
  })

  it('recordJumpFromHere clears the forward stack', () => {
    mountScrollContainer()
    useWorkspaceStore.getState().openTab('/ws/a.md')
    recordJumpFromHere()
    useWorkspaceStore.getState().openTab('/ws/b.md')
    goBack()
    expect(canGoForward()).toBe(true)

    useWorkspaceStore.getState().openTab('/ws/c.md')
    recordJumpFromHere()

    expect(canGoForward()).toBe(false)
  })

  it('goBack switches to the note that was active when the jump was recorded', () => {
    mountScrollContainer()
    useWorkspaceStore.getState().openTab('/ws/a.md')
    recordJumpFromHere()
    useWorkspaceStore.getState().openTab('/ws/b.md')

    goBack()

    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/a.md')
  })

  it('goBack is a no-op when there is nothing to go back to', () => {
    mountScrollContainer()
    useWorkspaceStore.getState().openTab('/ws/a.md')

    goBack()

    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/a.md')
  })

  it('goBack makes the note you left available to goForward', () => {
    mountScrollContainer()
    useWorkspaceStore.getState().openTab('/ws/a.md')
    recordJumpFromHere()
    useWorkspaceStore.getState().openTab('/ws/b.md')

    goBack()
    expect(canGoForward()).toBe(true)
    goForward()

    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/b.md')
  })

  it('goForward is a no-op when there is nothing to go forward to', () => {
    mountScrollContainer()
    useWorkspaceStore.getState().openTab('/ws/a.md')

    goForward()

    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/a.md')
  })

  it('supports multiple steps back and forward, in order', () => {
    mountScrollContainer()
    useWorkspaceStore.getState().openTab('/ws/a.md')
    recordJumpFromHere()
    useWorkspaceStore.getState().openTab('/ws/b.md')
    recordJumpFromHere()
    useWorkspaceStore.getState().openTab('/ws/c.md')

    goBack()
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/b.md')
    goBack()
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/a.md')

    goForward()
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/b.md')
    goForward()
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/c.md')
  })

  it('clearNavigationHistory empties both stacks', () => {
    mountScrollContainer()
    useWorkspaceStore.getState().openTab('/ws/a.md')
    recordJumpFromHere()
    useWorkspaceStore.getState().openTab('/ws/b.md')
    goBack()

    clearNavigationHistory()

    expect(canGoBack()).toBe(false)
    expect(canGoForward()).toBe(false)
  })
})
