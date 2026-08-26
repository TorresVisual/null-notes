import katex from 'katex'

export interface RenderedMath {
  html: string
  error: string | null
  /** Character offset into `latex` where KaTeX's parser gave up, or `null`
   *  when there's no error. Straight off `ParseError.position` — the same
   *  offset the error message's own combining-underline already points at
   *  (`\alpa` → `at position 1: \̲a̲l̲p̲a̲`), just not rendered visually
   *  anywhere in the source until P12-3. */
  errorPosition: number | null
  /** Length of the offending span. KaTeX reports 0 for an end-of-input error
   *  ("Expected '}', got 'EOF'") — there's nothing left to underline, so
   *  callers should render a zero-width marker at `errorPosition` rather
   *  than an empty range. */
  errorLength: number
}

/** Shared by `InlineMath` and `BlockMath`. `throwOnError: true` first is only
 *  a way to read `ParseError.position`/`.length` off the thrown error — the
 *  `throwOnError: false` fallback render is the same red-error markup KaTeX
 *  would have produced on its own either way. */
export function renderMath(latex: string, displayMode: boolean): RenderedMath {
  try {
    const html = katex.renderToString(latex, { throwOnError: true, displayMode })
    return { html, error: null, errorPosition: null, errorLength: 0 }
  } catch (e) {
    const html = katex.renderToString(latex, { throwOnError: false, displayMode })
    const message = e instanceof Error ? e.message : String(e)
    const parseError = e instanceof katex.ParseError ? e : null
    return {
      html,
      error: message.replace(/^KaTeX parse error: /, ''),
      errorPosition: parseError ? parseError.position : null,
      errorLength: parseError ? parseError.length : 0,
    }
  }
}
