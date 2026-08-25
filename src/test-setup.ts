import '@testing-library/jest-dom'

// jsdom doesn't implement elementFromPoint; ProseMirror's own mousedown
// handler calls it on every click inside the editable content to resolve
// posAtCoords, throwing an unhandled exception in any test that clicks
// there (e.g. a node view's own click-to-edit affordance).
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null
}

// jsdom implements getClientRects/getBoundingClientRect on Element but never
// defined either on Range. ProseMirror's scrollIntoView machinery — run by
// any command chain ending in the default `.focus()` — calls both on a Range
// to place the caret, and throws deep inside its own EditorView.updateState
// without them. That throw happens before dispatchTransaction's `emit`
// calls, so it silently swallows the editor's own 'transaction' and
// 'selectionUpdate' events in any test that mounts a real, DOM-attached
// editor and runs a focusing command.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function getClientRects() {
    return [] as unknown as DOMRectList
  }
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect
  }
}

// jsdom doesn't implement ResizeObserver, which cmdk (shadcn's Command
// component, used by SearchModal/QuickSwitcher) observes internally to
// track its list height — any test that mounts one throws a
// ReferenceError before the component ever renders.
if (!window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
