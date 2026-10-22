import { describe, it, expect, vi } from 'vitest'
import { platform } from '@tauri-apps/plugin-os'
import { isMobile, isWeb } from './platform'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))

describe('isMobile', () => {
  it('is true on iOS', () => {
    vi.mocked(platform).mockReturnValue('ios')
    expect(isMobile()).toBe(true)
  })

  it('is false on desktop platforms', () => {
    vi.mocked(platform).mockReturnValue('windows')
    expect(isMobile()).toBe(false)
  })
})

describe('isWeb', () => {
  it('is false unless the web build defines VITE_WEB', () => {
    expect(isWeb()).toBe(false)
  })
})
