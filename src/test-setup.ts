import '@testing-library/jest-dom'

// jsdom doesn't implement elementFromPoint; ProseMirror's own mousedown
// handler calls it on every click inside the editable content to resolve
// posAtCoords, throwing an unhandled exception in any test that clicks
// there (e.g. a node view's own click-to-edit affordance).
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null
}
