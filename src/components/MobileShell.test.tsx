import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { platform } from '@tauri-apps/plugin-os'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { MobileShell } from './MobileShell'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { discardIfUntouched } from '../hooks/useQuickNote'
import { useMobileOnboardingStore } from '../store/mobileOnboarding'
import { useActionSheetStore } from '../store/actionSheet'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn(() => 'android') }))
vi.mock('@tauri-apps/api/app', () => ({ onBackButtonPress: vi.fn() }))
vi.mock('../lib/tauri', () => ({ api: { window: { exitApp: vi.fn() } } }))
vi.mock('../hooks/useQuickNote', () => ({ discardIfUntouched: vi.fn() }))
vi.mock('./MobileNotes', () => ({ MobileNotes: () => <div>notes-screen</div> }))
vi.mock('./MobileOnboarding', () => ({ MobileOnboarding: () => <div>onboarding-screen</div> }))

let press: () => void

function setup(over: Partial<React.ComponentProps<typeof MobileShell>> = {}) {
  const props: React.ComponentProps<typeof MobileShell> = {
    activeOverlay: null,
    openOverlay: vi.fn(),
    closeOverlay: vi.fn(),
    onReviewOpen: vi.fn(),
    onNewNote: vi.fn(),
    hasWorkspace: true,
    noteTitle: 'Lecture 7',
    home: <div>home-screen</div>,
    editor: <div>editor-screen</div>,
    saveStatus: <span>saved</span>,
    gitBars: <div>git-bars</div>,
    overlays: <div>overlays</div>,
    onSyncNow: vi.fn(),
    syncing: false,
    ...over,
  }
  const view = render(<MobileShell {...props} />)
  return { props, ...view }
}

beforeEach(() => {
  useWorkspaceStore.setState({ activeTab: null, openTabs: [], repoMode: null, recentWorkspaces: [] })
  useMobileOnboardingStore.setState({ step: 'start' })
  vi.mocked(platform).mockReturnValue('android')
  vi.mocked(onBackButtonPress).mockImplementation(async (cb) => {
    press = () => cb({ canGoBack: false })
    return { unregister: vi.fn() } as never
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MobileShell tabs', () => {
  it('starts on Home and switches to Notes', async () => {
    setup()
    expect(screen.getByText('home-screen')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(screen.getByText('notes-screen')).toBeInTheDocument()
    expect(screen.queryByText('home-screen')).not.toBeInTheDocument()
  })

  it('Search opens its overlay instead of switching screen', async () => {
    const { props } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(props.openOverlay).toHaveBeenCalledWith('search')
    expect(screen.getByText('home-screen')).toBeInTheDocument()
  })

  it('has no Review tab: the bar is Home, Notes, Search, More', () => {
    setup()
    const bar = screen.getByRole('navigation', { name: 'Main' })
    expect(Array.from(bar.querySelectorAll('button'), (b) => b.textContent)).toEqual(['Home', 'Notes', 'Search', 'More'])
  })

  it('highlights the tab whose overlay is open', () => {
    setup({ activeOverlay: 'search' })
    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('MobileShell More sheet', () => {
  it('opens, hands the chosen overlay to openOverlay, and closes', async () => {
    const { props } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(props.openOverlay).toHaveBeenCalledWith('settings')
    expect(screen.queryByRole('button', { name: 'Tasks' })).not.toBeInTheDocument()
  })

  it('Review in the sheet opens the review overlay and closes the sheet', async () => {
    const { props } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(props.onReviewOpen).toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument()
  })

  it('offers Sync now only when a sync handler exists', async () => {
    const { unmount } = setup({ onSyncNow: null })
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
    unmount()
    const { props } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(props.onSyncNow).toHaveBeenCalled()
  })
})

describe('MobileShell new-note button', () => {
  it('shows on Home and Notes and calls onNewNote', async () => {
    const { props } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'New note' }))
    expect(props.onNewNote).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(screen.getByRole('button', { name: 'New note' })).toBeInTheDocument()
  })

  it('is hidden over the Search overlay, while the editor is open, and without a workspace', () => {
    const { unmount } = setup({ activeOverlay: 'search' })
    expect(screen.queryByRole('button', { name: 'New note' })).not.toBeInTheDocument()
    unmount()

    useWorkspaceStore.setState({ activeTab: '/ws/a.md', openTabs: ['/ws/a.md'] })
    const editorView = setup()
    expect(screen.queryByRole('button', { name: 'New note' })).not.toBeInTheDocument()
    editorView.unmount()

    useWorkspaceStore.setState({ activeTab: null, openTabs: [] })
    setup({ hasWorkspace: false })
    expect(screen.queryByRole('button', { name: 'New note' })).not.toBeInTheDocument()
  })
})

describe('MobileShell editor screen', () => {
  it('shows the editor, title and save status, and hides the tab bar when a note is active', () => {
    useWorkspaceStore.setState({ activeTab: '/ws/a.md', openTabs: ['/ws/a.md'] })
    setup()
    expect(screen.getByText('editor-screen')).toBeInTheDocument()
    expect(screen.getByText('Lecture 7')).toBeInTheDocument()
    expect(screen.getByText('saved')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('the back arrow leaves the editor but keeps the tab open', async () => {
    useWorkspaceStore.setState({ activeTab: '/ws/a.md', openTabs: ['/ws/a.md'] })
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(useWorkspaceStore.getState().activeTab).toBeNull()
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/a.md'])
    expect(screen.getByText('home-screen')).toBeInTheDocument()
  })
})

describe('leaving a quick note', () => {
  it('offers the open note to the cleanup from the back arrow and from system Back', async () => {
    useWorkspaceStore.setState({ activeTab: '/ws/a.md', openTabs: ['/ws/a.md'] })
    setup()
    await act(async () => {})
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(discardIfUntouched).toHaveBeenLastCalledWith('/ws/a.md')

    act(() => useWorkspaceStore.setState({ activeTab: '/ws/b.md', openTabs: ['/ws/a.md', '/ws/b.md'] }))
    act(() => press())
    expect(discardIfUntouched).toHaveBeenLastCalledWith('/ws/b.md')
  })
})

describe('MobileShell system Back', () => {
  it('pops overlay, then editor, then non-Home tab, then exits', async () => {
    useWorkspaceStore.setState({ activeTab: '/ws/a.md', openTabs: ['/ws/a.md'] })
    const { props, rerender } = setup({ activeOverlay: 'settings' })
    await act(async () => {})

    act(() => press())
    expect(props.closeOverlay).toHaveBeenCalledTimes(1)

    rerender(<MobileShell {...props} activeOverlay={null} />)
    act(() => press())
    expect(useWorkspaceStore.getState().activeTab).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    act(() => press())
    expect(screen.getByText('home-screen')).toBeInTheDocument()

    act(() => press())
    expect(api.window.exitApp).toHaveBeenCalledTimes(1)
  })
})

describe('MobileShell action sheet', () => {
  it('system Back closes an open row sheet before leaving the tab', async () => {
    setup()
    await act(async () => {})
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    act(() => useActionSheetStore.getState().open({ title: 'ss', actions: [] }))
    expect(screen.getByRole('dialog', { name: 'ss' })).toBeInTheDocument()

    act(() => press())
    expect(screen.queryByRole('dialog', { name: 'ss' })).not.toBeInTheDocument()
    expect(screen.getByText('notes-screen')).toBeInTheDocument()
  })
})

describe('MobileShell without a workspace', () => {
  it('shows the sign-in onboarding on first run, with no tab bar', () => {
    setup({ hasWorkspace: false })
    expect(screen.getByText('onboarding-screen')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
  })

  it('still shows the onboarding when there are recent workspaces', () => {
    useWorkspaceStore.setState({ recentWorkspaces: ['/ws'] })
    setup({ hasWorkspace: false })
    expect(screen.getByText('onboarding-screen')).toBeInTheDocument()
  })

  it('Back steps out of an onboarding screen to the start before exiting', async () => {
    useMobileOnboardingStore.setState({ step: 'repos' })
    setup({ hasWorkspace: false })
    await act(async () => {})

    act(() => press())
    expect(useMobileOnboardingStore.getState().step).toBe('start')
    expect(api.window.exitApp).not.toHaveBeenCalled()

    act(() => press())
    expect(api.window.exitApp).toHaveBeenCalledTimes(1)
  })
})
