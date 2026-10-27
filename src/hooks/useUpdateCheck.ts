import { useEffect, useState } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { api } from '../lib/tauri'
import { isMobile, isWeb } from '../lib/platform'

export function useUpdateCheck() {
  const [update, setUpdate] = useState<Update | null>(null)

  useEffect(() => {
    if (isWeb() || isMobile()) return
    void (async () => {
      try {
        if (await api.window.isReleaseBuild()) setUpdate(await check())
      } catch {
        // Offline or the release mirror is unreachable — the next launch retries.
      }
    })()
  }, [])

  return { update, dismiss: () => setUpdate(null) }
}
