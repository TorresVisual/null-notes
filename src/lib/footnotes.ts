// P13-1: footnote labels are conventionally sequential integers ("1", "2",
// …), though GFM itself allows any identifier (`[^note]`). Auto-numbering
// only ever advances past whichever *integer* labels are already in use —
// a hand-written `[^note]` doesn't collide with, or get skipped by, the
// auto-numbered sequence.
const INTEGER_LABEL = /^\d+$/

export function nextFootnoteLabel(existingLabels: string[]): string {
  const used = existingLabels.filter((label) => INTEGER_LABEL.test(label)).map(Number)
  const max = used.length ? Math.max(...used) : 0
  return String(max + 1)
}
