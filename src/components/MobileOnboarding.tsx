import { useEffect } from 'react'
import { useResumeSignIn } from '../hooks/useResumeSignIn'
import { useMobileOnboardingStore } from '../store/mobileOnboarding'
import { DeviceCodeScreen } from './DeviceCodeScreen'
import { GithubMark } from './GithubMark'
import { OnboardingTopBar } from './OnboardingTopBar'
import { RepoPickerScreen } from './RepoPickerScreen'
import { TokenCloneForm } from './TokenCloneForm'

export function MobileOnboarding() {
  const step = useMobileOnboardingStore((s) => s.step)
  const setStep = useMobileOnboardingStore((s) => s.setStep)

  const resumeChecked = useResumeSignIn()

  useEffect(() => () => setStep('start'), [setStep])

  if (!resumeChecked) return <div className="mobile-onboarding" />
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
      <div className="mobile-onboarding-foot">
        <button className="mobile-onboarding-cta" onClick={() => setStep('code')}>
          <GithubMark /> Sign in with GitHub
        </button>
        <button className="mobile-onboarding-link" onClick={() => setStep('token')}>
          Use a token instead
        </button>
      </div>
    </div>
  )
}
