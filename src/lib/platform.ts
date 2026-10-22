import { platform } from '@tauri-apps/plugin-os'

export function isMobile(): boolean {
  return platform() === 'ios' || platform() === 'android'
}

export function isWeb(): boolean {
  return import.meta.env.VITE_WEB === '1'
}
