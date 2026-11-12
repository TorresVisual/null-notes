import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { platform } from '@tauri-apps/plugin-os'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { api } from '../lib/tauri'
import { useBackButton } from './useBackButton'
import type { BackState } from '../lib/backNavigation'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))
vi.mock('@tauri-apps/api/app', () => ({ onBackButtonPress: vi.fn() }))
vi.mock('../lib/tauri', () => ({ api: { window: { exitApp: vi.fn() } } }))

const idle: BackState = { overlayOpen: false, sheetOpen: false, onboardingStep: false, editorOpen: false, noteHistory: false, tab: 'home' }
const handlers = () => ({
  'close-overlay': vi.fn(),
  'close-sheet': vi.fn(),
  'leave-onboarding-step': vi.fn(),
  'previous-note': vi.fn(),
  'close-editor': vi.fn(),
  'go-home': vi.fn(),
})

let press: () => void
const unregister = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(platform).mockReturnValue('android')
  vi.mocked(onBackButtonPress).mockImplementation(async (cb) => {
    press = () => cb({ canGoBack: false })
    return { unregister } as never
  })
})

describe('useBackButton', () => {
  it('runs the handler resolveBack picks, using the latest state', () => {
    const h = handlers()
    const { rerender } = renderHook(({ s }) => useBackButton(s, h), { initialProps: { s: idle } })
    rerender({ s: { ...idle, editorOpen: true } })
    press()
    expect(h['close-editor']).toHaveBeenCalledTimes(1)
  })

  it('exits the app when nothing is left to pop', () => {
    renderHook(() => useBackButton(idle, handlers()))
    press()
    expect(api.window.exitApp).toHaveBeenCalled()
  })

  it('does not register on desktop', () => {
    vi.mocked(platform).mockReturnValue('windows')
    renderHook(() => useBackButton(idle, handlers()))
    expect(onBackButtonPress).not.toHaveBeenCalled()
  })

  it('unregisters on unmount', async () => {
    const { unmount } = renderHook(() => useBackButton(idle, handlers()))
    unmount()
    await Promise.resolve()
    expect(unregister).toHaveBeenCalled()
  })
})
