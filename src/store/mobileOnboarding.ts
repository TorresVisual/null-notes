import { create } from 'zustand'

export type OnboardingStep = 'start' | 'code' | 'repos' | 'token'

interface MobileOnboardingStore {
  step: OnboardingStep
  setStep: (step: OnboardingStep) => void
}

export const useMobileOnboardingStore = create<MobileOnboardingStore>((set) => ({
  step: 'start',
  setStep: (step) => set({ step }),
}))
