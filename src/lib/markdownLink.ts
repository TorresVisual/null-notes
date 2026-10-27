import type { MarkType } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

const OPEN_LINK = /(?<!!)\[([^\]\n]+)\]\(([^)\n]+)$/

/**
 * Turns the `[label](destination` ending at `pos` into a link. `swallow` is
 * how many characters after `pos` belong to it: 1 when the closing `)` is
 * already in the document (the editor auto-closes brackets), 0 when it is
 * still being typed.
 */
export function applyMarkdownLink(tr: Transaction, linkType: MarkType, pos: number, swallow: number): boolean {
  const $pos = tr.doc.resolve(pos)
  if ($pos.parent.type.spec.code) return false

  const before = tr.doc.textBetween($pos.start(), pos, '\n', '￼')
  const match = OPEN_LINK.exec(before)
  if (!match) return false

  const [whole, label = '', destination = ''] = match
  tr.replaceWith(
    pos - whole.length,
    pos + swallow,
    tr.doc.type.schema.text(label, [linkType.create({ href: destination.trim() })]),
  ).setStoredMarks([])
  return true
}
