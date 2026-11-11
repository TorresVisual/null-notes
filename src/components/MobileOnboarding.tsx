import { useEffect } from 'react'
import { useStoredSignIn } from '../hooks/useStoredSignIn'
import { useMobileOnboardingStore } from '../store/mobileOnboarding'
import { DeviceCodeScreen } from './DeviceCodeScreen'
import { GithubMark } from './GithubMark'
import { OnboardingRecents } from './OnboardingRecents'
import { OnboardingTopBar } from './OnboardingTopBar'
import { RepoPickerScreen } from './RepoPickerScreen'
import { TokenCloneForm } from './TokenCloneForm'

export function MobileOnboarding() {
  const step = useMobileOnboardingStore((s) => s.step)
  const setStep = useMobileOnboardingStore((s) => s.setStep)

  const { checked, signedIn } = useStoredSignIn()

  useEffect(() => () => setStep('start'), [setStep])

  if (!checked) return <div className="mobile-onboarding" />
  if (step === 'code') return <DeviceCodeScreen />
  if (step === 'repos') return <RepoPickerScreen />
  if (step === 'token') {
    return (
      <div className="mobile-onboarding">
        <OnboardingTopBar title="Use a token" onBack={() => setStep('start')} />
        <div className="mobile-onboarding-body">
          <TokenCloneForm />
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-onboarding">
      <div className="mobile-onboarding-hero">
        <img src="/favicon.svg" alt="" width={80} height={80} className="mobile-onboarding-mark" />
        <h1 className="mobile-onboarding-name">Null Notes</h1>
        <p className="mobile-onboarding-line">Plain Markdown notes, synced through your own GitHub.</p>
      </div>
      <OnboardingRecents />
      <div className="mobile-onboarding-foot">
        <button className="mobile-onboarding-cta" onClick={() => setStep(signedIn ? 'repos' : 'code')}>
          <GithubMark /> {signedIn ? 'Clone from GitHub' : 'Sign in with GitHub'}
        </button>
        <button className="mobile-onboarding-link" onClick={() => setStep(signedIn ? 'code' : 'token')}>
          {signedIn ? 'Sign in again' : 'Use a token instead'}
        </button>
      </div>
    </div>
  )
}
