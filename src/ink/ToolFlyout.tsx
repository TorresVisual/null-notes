import type { ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface ToolFlyoutProps {
  active: boolean
  onActivate: () => void
  label: string
  title?: string
  className: string
  icon: ReactNode
  children: ReactNode
}

// The first click on an idle tool only selects it; the flyout is for a tool
// already in hand. preventDefault stops Radix's own toggle from also firing.
export function ToolFlyout({ active, onActivate, label, title, className, icon, children }: ToolFlyoutProps) {
  return (
    <Popover>
      <PopoverTrigger
        asChild
        onClick={(e) => {
          if (active) return
          e.preventDefault()
          onActivate()
        }}
      >
        <button
          type="button"
          className={`${className}${active ? ' active' : ''}`}
          aria-pressed={active}
          aria-label={label}
          title={title ?? label}
        >
          {icon}
        </button>
      </PopoverTrigger>
      <PopoverContent className="ink-flyout" align="start" sideOffset={6}>
        {children}
      </PopoverContent>
    </Popover>
  )
}
