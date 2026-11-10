import { useCallback, useEffect, useRef, useState } from 'react'
import { inkApi } from '../lib/ink'
import type { InkData } from '../ink/types'

export function useInkSidecar(src: string | null): { data: InkData | null; refresh: () => void } {
  const [data, setData] = useState<InkData | null>(null)
  const latestRead = useRef(0)

  // Reads can resolve out of order when saves land close together, so only the
  // newest request is allowed to write the result.
  const refresh = useCallback(() => {
    if (!src) return
    const id = ++latestRead.current
    void inkApi.read(src).then((next) => {
      if (id === latestRead.current) setData(next)
    })
  }, [src])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { data, refresh }
}
