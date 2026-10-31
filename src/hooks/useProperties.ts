import { useEffect, useState } from 'react'
import { api } from '../lib/tauri'
import { splitFrontmatter } from '../lib/frontmatter'

interface PropertiesState {
  properties: Record<string, unknown>
  error: string | null
}

const EMPTY: PropertiesState = { properties: {}, error: null }

// Keyed on the frontmatter block, not the whole note, so typing in the body
// never costs an IPC round trip.
export function useProperties(content: string): PropertiesState {
  const { frontmatter } = splitFrontmatter(content)
  const [state, setState] = useState<PropertiesState>(EMPTY)

  useEffect(() => {
    if (!frontmatter) {
      setState(EMPTY)
      return
    }
    let cancelled = false
    api.properties
      .parse(frontmatter)
      .then((result) => {
        if (!cancelled) setState({ properties: result.properties, error: result.error })
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ properties: {}, error: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [frontmatter])

  return state
}
