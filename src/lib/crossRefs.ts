/**
 * Recognising a cross-reference in prose: `Theorem 3.2`, `Lemma 5`,
 * `Definition 1.1` — a P6-1 block-type keyword plus its own number.
 *
 * Deliberately keyed to the exact `calloutType` set P6-1 gave numbering to,
 * so a match always names a real, resolvable block *kind*. `[[Theorem: name]]`
 * is a separate, existing mechanism (an ordinary wiki-link) and untouched.
 */

export interface CrossRef {
  /** Lowercase, matching the `calloutType` attribute the block itself carries. */
  calloutType: string
  number: string
  from: number
  to: number
}

const KEYWORDS = ['Theorem', 'Lemma', 'Corollary', 'Proof', 'Definition', 'Example', 'Algorithm']

// A number is digits, optionally dotted ("3", "3.2", "3.2.1") — the same
// shape `> [!THEOREM 3.2]` accepts as its own `number` attribute.
const PATTERN = new RegExp(`\\b(${KEYWORDS.join('|')})\\s+(\\d+(?:\\.\\d+)*)\\b`, 'gi')

export function findCrossRefs(text: string): CrossRef[] {
  const found: CrossRef[] = []
  for (const match of text.matchAll(PATTERN)) {
    const whole = match[0]
    const index = match.index ?? 0
    const keyword = match[1]
    const number = match[2]
    if (!keyword || !number) continue
    found.push({
      calloutType: keyword.toLowerCase(),
      number,
      from: index,
      to: index + whole.length,
    })
  }
  return found
}
