// Shared by InlineMath's <input> and BlockMath's <textarea> (P12-2), and by
// the top-toolbar symbol palette that reaches into whichever one is active
// (P12-4). Both node views' editing overlays, and the palette that can be
// open on behalf of either one, count as one editing surface: moving focus
// *within* it must never count as "leaving" it. Naively committing on every
// `blur` closes the whole overlay out from under a click into a sibling
// field (or into the palette), using whatever that field held *before* the
// user had a chance to act on it.
//
// A global class-name selector, not a specific instance's own subtree: only
// one math node can be "active" at a time (the same single-slot invariant
// `useMathEditorStore` enforces for the palette itself), so there is never
// a second instance's surface to mistake this one for.
const MATH_EDITING_SURFACE_SELECTOR = '.block-math-editor, .math-editor, .symbol-palette'

export function focusLeftMathEditingSurface(active: Element | null): boolean {
  return !active?.closest(MATH_EDITING_SURFACE_SELECTOR)
}

// Deliberately not `event.relatedTarget`: it's the standard way to ask
// "where did focus go", but it isn't reliably populated for every
// focus-shift path (least of all in jsdom, this codebase's test
// environment) — the robust version of this check is the same
// setTimeout-deferred `document.activeElement` read most component
// libraries use for exactly this "did focus leave the whole widget"
// question, since by the next tick the browser has always settled on
// wherever focus actually landed.
export function commitUnlessFocusLeaves(commit: (refocus: boolean) => void): void {
  setTimeout(() => {
    if (focusLeftMathEditingSurface(document.activeElement)) commit(false)
  }, 0)
}
