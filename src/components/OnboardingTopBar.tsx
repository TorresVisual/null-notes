import { ArrowLeft } from 'lucide-react'

interface OnboardingTopBarProps {
  title: string
  onBack: () => void
}

export function OnboardingTopBar({ title, onBack }: OnboardingTopBarProps) {
  return (
    <header className="mobile-onboarding-top">
      <button className="mobile-onboarding-back" aria-label="Back" onClick={onBack}>
        <ArrowLeft size={20} />
      </button>
      <span>{title}</span>
    </header>
  )
}
