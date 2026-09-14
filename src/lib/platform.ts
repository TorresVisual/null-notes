import { platform } from '@tauri-apps/plugin-os'

export function isMobile(): boolean {
  return platform() === 'ios' || platform() === 'android'
}
