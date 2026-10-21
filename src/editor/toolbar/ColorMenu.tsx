import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export const COLOR_HUES = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#9ca3af',
] as const

interface ColorMenuProps {
  label: string
  icon: ReactNode
  /** Maps a hue to the value stored in the note — a highlight needs it translucent so text stays legible on both themes. */
  toValue: (hue: string) => string
  current: string | null
  onPick: (value: string | null) => void
}

export function ColorMenu({ label, icon, toValue, current, onPick }: ColorMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  function pick(value: string | null) {
    onPick(value)
    setOpen(false)
  }

  return (
    <div className="symbol-palette-anchor" ref={ref}>
      <button
        className={`toolbar-button${current ? ' active' : ''}`}
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open && (
        <div className="color-menu" role="menu" aria-label={label}>
          {COLOR_HUES.map((hue) => {
            const value = toValue(hue)
            return (
              <button
                key={hue}
                type="button"
                role="menuitem"
                className={`color-swatch${value === current ? ' selected' : ''}`}
                style={{ background: value }}
                aria-label={hue}
                title={hue}
                onClick={() => pick(value)}
              />
            )
          })}
          <button type="button" role="menuitem" className="color-reset" onClick={() => pick(null)}>
            Default
          </button>
        </div>
      )}
    </div>
  )
}
