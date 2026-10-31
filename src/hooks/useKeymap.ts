import { useMemo } from 'react'
import { useSettingsStore } from '../store/settings'
import { effectiveKeymap } from '../lib/keymap'

export function useKeymap(): Record<string, string> {
  const overrides = useSettingsStore((s) => s.settings.keymap)
  return useMemo(() => effectiveKeymap(overrides), [overrides])
}
