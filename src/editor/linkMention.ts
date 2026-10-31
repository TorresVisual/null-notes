import type { Editor } from '@tiptap/core'
import { findDocMatches } from './extensions/FindReplace'

export const LINK_MENTION_EVENT = 'outgoing-links:link-mention'

const PROSE_ONLY_MARKS = new Set(['code', 'link'])

/** Turns the first plain-prose mention of `title` into a wiki-link, keeping the
 *  typed casing as the label. Text in code, existing links or code blocks is
 *  left alone. Returns whether anything was linked. */
export function linkMention(editor: Editor, title: string): boolean {
  const { doc } = editor.state
  const match = findDocMatches(doc, title, { caseSensitive: false, wholeWord: true, useRegex: false }).find(
    (m) =>
      m.kind === 'text' &&
      !doc.resolve(m.from).parent.type.spec.code &&
      !doc.nodeAt(m.from)?.marks.some((mark) => PROSE_ONLY_MARKS.has(mark.type.name)),
  )
  if (!match) return false
  const typed = doc.textBetween(match.from, match.to)
  return editor
    .chain()
    .insertContentAt(
      { from: match.from, to: match.to },
      { type: 'wikiLink', attrs: { title, heading: '', label: typed === title ? '' : typed } },
    )
    .run()
}
