import { browser } from '@wdio/globals'
import axe from 'axe-core'

export interface AxeViolation {
  id: string
  impact: string
  nodes: string[]
}

// Runs axe over `selector` (whole page if omitted) and returns serious/critical
// violations only — minor/moderate are the noise this check deliberately skips.
// axe.source is injected as a script body, so it needs no <script> tag and is
// unaffected by the app's CSP.
export async function seriousViolations(selector?: string): Promise<AxeViolation[]> {
  await browser.execute(axe.source)
  return browser.executeAsync(
    (sel: string | null, done: (v: AxeViolation[]) => void) => {
      const lib = (window as unknown as { axe: typeof axe }).axe
      lib.run(sel ? { include: [sel] } : document).then((r) =>
        done(
          r.violations
            .filter((v) => v.impact === 'serious' || v.impact === 'critical')
            .map((v) => ({ id: v.id, impact: String(v.impact), nodes: v.nodes.map((n) => n.target.join(' ')) })),
        ),
      )
    },
    selector ?? null,
  )
}

// Fails on any serious/critical rule not in `known`. `known` is the committed
// debt: shrink it as violations get fixed, never grow it to silence a new one.
export function newViolations(found: AxeViolation[], known: readonly string[]): AxeViolation[] {
  return found.filter((v) => !known.includes(v.id))
}
