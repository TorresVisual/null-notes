import { describe, it, expect, vi } from 'vitest'
import { platform } from '@tauri-apps/plugin-os'
import { isMobile } from './platform'

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
