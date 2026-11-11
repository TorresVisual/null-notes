import { describe, it, expect } from 'vitest'
import { useMobileOnboardingStore } from './mobileOnboarding'

describe('useMobileOnboardingStore', () => {
  it('starts on the start screen and tracks the current step', () => {
    expect(useMobileOnboardingStore.getState().step).toBe('start')
    useMobileOnboardingStore.getState().setStep('code')
    expect(useMobileOnboardingStore.getState().step).toBe('code')
    useMobileOnboardingStore.getState().setStep('start')
  })
})
