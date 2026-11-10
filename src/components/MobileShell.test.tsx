import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { platform } from '@tauri-apps/plugin-os'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { MobileShell } from './MobileShell'
import { api } from '../lib/tauri'
import { useWorkspaceStore } from '../store/workspace'
import { discardIfUntouched } from '../hooks/useQuickNote'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn(() => 'android') }))
vi.mock('@tauri-apps/api/app', () => ({ onBackButtonPress: vi.fn() }))
vi.mock('../lib/tauri', () => ({ api: { window: { exitApp: vi.fn() } } }))
vi.mock('../hooks/useQuickNote', () => ({ discardIfUntouched: vi.fn() }))
vi.mock('./MobileNotes', () => ({ MobileNotes: () => <div>notes-screen</div> }))

let press: () => void

function setup(over: Partial<React.ComponentProps<typeof MobileShell>> = {}) {
  const props: React.ComponentProps<typeof MobileShell> = {
    activeOverlay: null,
    openOverlay: vi.fn(),
    closeOverlay: vi.fn(),
    onReviewOpen: vi.fn(),
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
  useWorkspaceStore.setState({ activeTab: null, openTabs: [], repoMode: null })
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

  it('Search and Review open their overlays instead of switching screen', async () => {
    const { props } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(props.openOverlay).toHaveBeenCalledWith('search')
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(props.onReviewOpen).toHaveBeenCalled()
    expect(screen.getByText('home-screen')).toBeInTheDocument()
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

describe('MobileShell without a workspace', () => {
  it('shows the picker slot and no tab bar', () => {
    setup({ hasWorkspace: false })
    expect(screen.getByText('editor-screen')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
  })
})
