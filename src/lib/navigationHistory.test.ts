import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore } from '../store/workspace'
import {
  goBack,
  goForward,
  canGoBack,
  canGoForward,
  clearNavigationHistory,
  useNavigationHistoryStore,
} from './navigationHistory'

function mountScrollContainer(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'editor-scroll'
  document.body.appendChild(el)
  return el
}

beforeEach(() => {
  useWorkspaceStore.setState({ openTabs: [], activeTab: null })
  clearNavigationHistory()
  document.body.innerHTML = ''
})

describe('navigationHistory', () => {
  it('starts with nothing to go back or forward to', () => {
    expect(canGoBack()).toBe(false)
    expect(canGoForward()).toBe(false)
  })

  it('opening the first note does not create back history', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    expect(canGoBack()).toBe(false)
  })

  it('switching to a different note pushes the previous one onto the back stack', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    expect(canGoBack()).toBe(true)
  })

  it('re-selecting the already-active note does not push history', () => {
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/a.md')
    expect(canGoBack()).toBe(false)
  })

  it('switching notes clears the forward stack', () => {
    mountScrollContainer()
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    goBack()
    expect(canGoForward()).toBe(true)

    useWorkspaceStore.getState().openTab('/ws/c.md')

    expect(canGoForward()).toBe(false)
  })

  it('goBack switches to the previously active note', () => {
    mountScrollContainer()
    useWorkspaceStore.getState().openTab('/ws/a.md')
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
    useWorkspaceStore.getState().openTab('/ws/b.md')
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

  it('goBack does not itself get recorded as a new navigation', () => {
    mountScrollContainer()
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    useWorkspaceStore.getState().openTab('/ws/c.md')

    goBack()
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/b.md')

    goBack()
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/a.md')
  })

  it('clearNavigationHistory empties both stacks', () => {
    mountScrollContainer()
    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    goBack()

    clearNavigationHistory()

    expect(canGoBack()).toBe(false)
    expect(canGoForward()).toBe(false)
  })

  it('useNavigationHistoryStore tracks canGoBack/canGoForward in step with the functions', () => {
    mountScrollContainer()
    expect(useNavigationHistoryStore.getState()).toEqual({ canGoBack: false, canGoForward: false })

    useWorkspaceStore.getState().openTab('/ws/a.md')
    useWorkspaceStore.getState().openTab('/ws/b.md')
    expect(useNavigationHistoryStore.getState().canGoBack).toBe(true)

    goBack()
    expect(useNavigationHistoryStore.getState().canGoForward).toBe(true)

    clearNavigationHistory()
    expect(useNavigationHistoryStore.getState()).toEqual({ canGoBack: false, canGoForward: false })
  })
})
