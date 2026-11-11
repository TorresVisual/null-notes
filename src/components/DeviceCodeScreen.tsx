import { openUrl } from '@tauri-apps/plugin-opener'
import { useGithubDeviceFlow } from '../hooks/useGithubDeviceFlow'
import { useMobileOnboardingStore } from '../store/mobileOnboarding'
import { OnboardingTopBar } from './OnboardingTopBar'

const FAILED_COPY = {
  expired: 'This code expired.',
  denied: 'GitHub sign-in was declined.',
} as const

export function DeviceCodeScreen() {
  const setStep = useMobileOnboardingStore((s) => s.setStep)
  const { code, status, error, restart } = useGithubDeviceFlow(() => setStep('repos'))

  async function copyAndOpen() {
    if (!code) return
    await navigator.clipboard.writeText(code.userCode).catch(() => undefined)
    await openUrl(code.verificationUri)
  }

  const failed = status === 'expired' || status === 'denied' || status === 'error'

  return (
    <div className="mobile-onboarding">
      <OnboardingTopBar title="Sign in with GitHub" onBack={() => setStep('start')} />
      <div className="mobile-onboarding-body">
        {failed ? (
          <p className="workspace-picker-error" role="alert">
            {status === 'error' ? error : FAILED_COPY[status]}
          </p>
        ) : (
          <>
            <ol className="mobile-onboarding-steps">
              <li><span>1</span>Copy this code</li>
              <li><span>2</span>Open GitHub, paste it, and tap Authorize</li>
              <li><span>3</span>Come back here. This screen continues by itself.</li>
            </ol>
            <div className="mobile-onboarding-code" aria-live="polite">
              {code?.userCode ?? '········'}
            </div>
            <p className="mobile-onboarding-wait">
              {status === 'starting' ? 'Getting a code…' : 'Waiting for GitHub…'}
            </p>
          </>
        )}
      </div>
      <div className="mobile-onboarding-foot">
        {failed ? (
          <button className="mobile-onboarding-cta" onClick={() => void restart()}>
            Try again
          </button>
        ) : (
          <button className="mobile-onboarding-cta" disabled={!code} onClick={() => void copyAndOpen()}>
            Copy code and open GitHub
          </button>
        )}
        <button className="mobile-onboarding-link" onClick={() => setStep('start')}>
          Cancel
        </button>
      </div>
    </div>
  )
}
