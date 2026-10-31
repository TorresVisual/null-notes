import { useEffect } from 'react'
import { useUpdateStore } from '../store/update'

// Offline or an unreachable release mirror is swallowed by the store — the next launch retries.
export function useUpdateCheck() {
  useEffect(() => {
    void useUpdateStore.getState().checkForUpdate()
  }, [])
}
