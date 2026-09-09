import { Loader2 } from 'lucide-react'

export function LoadingStatus() {
  return (
    <p className="status">
      <Loader2 size={14} className="spin" /> Loading…
    </p>
  )
}
