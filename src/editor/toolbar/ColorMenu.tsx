import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

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
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(event: MouseEvent) {
      const target = event.target as Node
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Portalled to <body>: the toolbar's scroll region is `overflow-x: auto`,
  // which clips an absolutely-positioned child on the y axis too.
  function toggle() {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setPosition({ top: rect.bottom + 4, left: rect.left })
    setOpen((o) => !o)
  }

  function pick(value: string | null) {
    onPick(value)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={buttonRef}
        className={`toolbar-button${current ? ' active' : ''}`}
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={toggle}
      >
        {icon}
      </button>
      {open && createPortal(
        <div className="color-menu" role="menu" aria-label={label} ref={menuRef} style={position} onMouseDown={(e) => e.preventDefault()}>
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
        </div>,
        document.body,
      )}
    </>
  )
}
