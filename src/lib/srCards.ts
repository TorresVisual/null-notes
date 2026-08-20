/**
 * Recognising a review card's own text (P9-3), so the editor can highlight
 * it — decoration only, never a schema change (a card must stay ordinary,
 * portable Markdown). Operates on one text node's content at a time, the
 * same granularity `findCodeLinks` uses; a card's front/back is expected to
 * be that node's entire text, matching how `extract_cards` treats a card as
 * an entire source line.
 *
 * Design: `docs/specs/spaced-repetition-design.md`.
 */

export interface SrCardSpan {
  kind: 'qa' | 'cloze'
  from: number
  to: number
}

const QA_PATTERN = /^(.+?)\s::\s(.+)$/
const CLOZE_PATTERN = /\{\{[^{}]+\}\}/

export function findSrCardSpans(text: string): SrCardSpan[] {
  if (!text || text.trim().startsWith('<!--')) return []

  if (QA_PATTERN.test(text)) {
    return [{ kind: 'qa', from: 0, to: text.length }]
  }
  if (CLOZE_PATTERN.test(text)) {
    return [{ kind: 'cloze', from: 0, to: text.length }]
  }
  return []
}
