import { useEffect, useState } from 'react'
import { getStoredGitToken } from '../lib/gitCredentials'

interface StoredSignIn {
  checked: boolean
  signedIn: boolean
}

/** Whether an earlier sign-in left a token in the keystore. */
export function useStoredSignIn(): StoredSignIn {
  const [state, setState] = useState<StoredSignIn>({ checked: false, signedIn: false })

  useEffect(() => {
    getStoredGitToken()
      .then((token) => setState({ checked: true, signedIn: token !== '' }))
      .catch(() => setState({ checked: true, signedIn: false }))
  }, [])

  return state
}
