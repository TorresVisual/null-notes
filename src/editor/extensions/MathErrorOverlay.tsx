interface MathErrorOverlayProps {
  latex: string
  errorPosition: number | null
  errorLength: number
  className: string
  /** `BlockMath`'s field is a block-level `<textarea>`; `InlineMath`'s is an
   *  inline `<input>` sitting mid-sentence. The overlay has to match its
   *  field's own element type or the two would lay out in different flows
   *  and drift apart. */
  as?: 'div' | 'span'
}

/** Sits on top of the real `<input>`/`<textarea>` (P12-3), not behind it —
 *  its own text is fully transparent so the field's real, opaque glyphs show
 *  through unchanged; only the `<mark>` over the offending span paints
 *  anything, a translucent tint over those real glyphs, the same way a
 *  native text-selection highlight sits over text rather than replacing it.
 *  That means the overlay never needs to fight the field for a matching
 *  background/border, and a manually resized `<textarea>` (`resize:
 *  vertical`) is tracked for free — `inset: 0` fills whatever height the
 *  in-flow field just established in their shared wrapper.
 *
 *  Sharing the field's own className keeps font/padding/line-height/
 *  white-space identical, which is what keeps the mark aligned with the
 *  real characters underneath it; `math-error-overlay` layers the
 *  positioning and transparency on top. */
export function MathErrorOverlay({ latex, errorPosition, errorLength, className, as = 'div' }: MathErrorOverlayProps) {
  if (errorPosition === null) return null

  const start = Math.min(errorPosition, latex.length)
  const end = Math.min(start + errorLength, latex.length)
  const before = latex.slice(0, start)
  const marked = latex.slice(start, end)
  const after = latex.slice(end)
  const Tag = as

  return (
    <Tag className={`${className} math-error-overlay`} aria-hidden="true">
      {before}
      {/* A zero-length span (an end-of-input error) still needs a rendered
       *  node to carry the mark's background — an empty <mark> collapses to
       *  no width at all, so it falls back to a hair-width caret instead. */}
      <mark className="math-error-mark">{marked || <span className="math-error-caret" />}</mark>
      {after}
    </Tag>
  )
}
