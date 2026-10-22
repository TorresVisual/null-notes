import { useEffect, useRef } from 'react'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { api } from '../lib/tauri'
import { isMobile } from '../lib/platform'
import { resolveBack, type BackAction, type BackState } from '../lib/backNavigation'

export type BackHandlers = Record<Exclude<BackAction, 'exit'>, () => void>

// Registering a listener replaces the platform default (walk the WebView
// history, then finish the activity), so 'exit' has to be done here. Notes are
// already on disk via autosave; window.close() would not end the activity.
export function useBackButton(state: BackState, handlers: BackHandlers) {
  const latest = useRef({ state, handlers })
  useEffect(() => {
    latest.current = { state, handlers }
  })

  useEffect(() => {
    if (!isMobile()) return
    const listener = onBackButtonPress(() => {
      const { state, handlers } = latest.current
      const action = resolveBack(state)
      if (action === 'exit') void api.window.exitApp()
      else handlers[action]()
    })
    return () => void listener.then((l) => l.unregister())
  }, [])
}
