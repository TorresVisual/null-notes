import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { browser } from '@wdio/globals'

const here = dirname(fileURLToPath(import.meta.url))

// Repo-local and gitignored (see .gitignore), not tmpdir: the point is for
// the user to open the PNG themselves in their own viewer after a run, so it
// needs a path they'll actually stumble back onto — not one the OS quietly
// sweeps. Same fixed-path reasoning as fixtureWorkspace.ts otherwise.
export const screenshotDir = join(here, '.artifacts')

mkdirSync(screenshotDir, { recursive: true })

// Writes a PNG and returns its absolute path. Deliberately does NOT get
// piped through Claude's Read/vision by default — a screenshot is
// image tokens, and burning them on every spec run isn't the point. The
// point is a file the user can pop open themselves to see whether the
// feature actually looks right; only Read it into the conversation if the
// user specifically asks for an in-context look.
export async function screenshot(name: string): Promise<string> {
  const path = join(screenshotDir, `${name}.png`)
  await browser.saveScreenshot(path)
  return path
}
