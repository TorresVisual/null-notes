/**
 * Recognising a cross-reference in prose: `Theorem 3.2`, `Lemma 5`,
 * `Definition 1.1`, `Equation (3)`, `Figure 2` — a P6-1 block-type keyword (or P12-2's
 * `Equation`) plus its own number, optionally parenthesized.
 *
 * Deliberately keyed to the exact keyword set P6-1/P12-2 gave numbering to,
 * so a match always names a real, resolvable block *kind*. `[[Theorem: name]]`
 * is a separate, existing mechanism (an ordinary wiki-link) and untouched.
 * `Equation` resolves against a `BlockMath` node's `number` attribute rather
 * than a `Callout`'s — `CrossRef.ts` branches on `calloutType === 'equation'`
 * to look in the right place, reusing this same decoration/resolution
 * machinery rather than adding a second one.
 */

export interface CrossRef {
  /** Lowercase, matching the `calloutType` attribute the block itself carries
   *  — or the literal `'equation'` for a `BlockMath` reference. */
  calloutType: string
  number: string
  from: number
  to: number
}

const KEYWORDS = ['Theorem', 'Lemma', 'Corollary', 'Proof', 'Definition', 'Example', 'Algorithm', 'Equation', 'Task', 'Figure']

// The exercise splitter's own opener spellings (`keyword_pattern()` in
// exercises.rs); it renames them all to `## Task N`, so they all resolve there.
const TASK_SYNONYMS = ['Aufgabe', 'Beispiel', 'Exercise', 'Problem']
const PATTERN_KEYWORDS = [...KEYWORDS, ...TASK_SYNONYMS]

// A number is digits, optionally dotted ("3", "3.2", "3.2.1") — the same
// shape `> [!THEOREM 3.2]` accepts as its own `number` attribute. Parens are
// optional so both "Theorem 3.2" and "Equation (3)" — the conventional way
// to write an equation reference — match the one pattern.
const PATTERN = new RegExp(`\\b(${PATTERN_KEYWORDS.join('|')})\\s+\\(?(\\d+(?:\\.\\d+)*)\\)?\\b`, 'gi')

export function findCrossRefs(text: string): CrossRef[] {
  const found: CrossRef[] = []
  for (const match of text.matchAll(PATTERN)) {
    const whole = match[0]
    const index = match.index ?? 0
    const keyword = match[1]
    const number = match[2]
    if (!keyword || !number) continue
    const lower = keyword.toLowerCase()
    found.push({
      calloutType: TASK_SYNONYMS.some((s) => s.toLowerCase() === lower) ? 'task' : lower,
      number,
      from: index,
      to: index + whole.length,
    })
  }
  return found
}
