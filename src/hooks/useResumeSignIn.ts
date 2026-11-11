import { useEffect, useState } from 'react'
import { getStoredGitToken } from '../lib/gitCredentials'
import { useMobileOnboardingStore } from '../store/mobileOnboarding'

/** A token left in the keystore by an earlier sign-in skips straight to the repo picker. */
export function useResumeSignIn(): boolean {
  const setStep = useMobileOnboardingStore((s) => s.setStep)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    getStoredGitToken()
      .then((token) => {
        if (token) setStep('repos')
      })
      .catch(() => undefined)
      .finally(() => setChecked(true))
  }, [setStep])

  return checked
}
