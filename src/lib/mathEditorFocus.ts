// Shared by InlineMath's <input> and BlockMath's <textarea> (originally
// P12-2, generalized for P12-4). The editing overlay now has more than one
// focusable field — latex, equation number, symbol-palette search — and
// moving focus *between* them must not count as "leaving" the editor:
// naively committing on every `blur` closes the whole overlay out from
// under a click into a sibling field, using whatever that field held
// *before* the user had a chance to type into it.
//
// Deliberately not `event.relatedTarget`: it's the standard way to ask
// "where did focus go", but it isn't reliably populated for every
// focus-shift path (least of all in jsdom, this codebase's test
// environment) — the robust version of this check is the same
// setTimeout-deferred `document.activeElement` read most component
// libraries use for exactly this "did focus leave the whole widget"
// question, since by the next tick the browser has always settled on
// wherever focus actually landed.
export function commitUnlessFocusLeaves(
  scopeSelector: string,
  fieldInEditor: HTMLElement,
  commit: (refocus: boolean) => void,
): void {
  const editorEl = fieldInEditor.closest(scopeSelector)
  setTimeout(() => {
    if (editorEl?.contains(document.activeElement)) return
    commit(false)
  }, 0)
}
