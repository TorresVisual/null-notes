import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { browser } from '@wdio/globals'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { screenshotDir } from './screenshot.js'

const here = dirname(fileURLToPath(import.meta.url))
const baselineDir = join(here, 'baselines')

// Share of pixels allowed to differ. Font antialiasing differs a little between
// machines and GPU drivers; a real layout regression moves far more than this.
const MAX_DIFF_RATIO = 0.01

// Compares an element's screenshot with e2e/baselines/<name>.png. Baselines are
// per-machine-class (Windows, WebView2, 100% scale): regenerate with
// UPDATE_BASELINE=1 after an intended visual change or on a different display.
export async function expectMatchesBaseline(name: string, selector: string): Promise<void> {
  const el = await browser.$(selector)
  const actualPath = join(screenshotDir, `${name}.actual.png`)
  await el.saveScreenshot(actualPath)

  const baselinePath = join(baselineDir, `${name}.png`)
  if (process.env.UPDATE_BASELINE || !existsSync(baselinePath)) {
    mkdirSync(baselineDir, { recursive: true })
    writeFileSync(baselinePath, readFileSync(actualPath))
    return
  }

  const actual = PNG.sync.read(readFileSync(actualPath))
  const expected = PNG.sync.read(readFileSync(baselinePath))
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `${name}: size ${actual.width}x${actual.height} != baseline ${expected.width}x${expected.height} (see ${actualPath})`,
    )
  }

  const diff = new PNG({ width: actual.width, height: actual.height })
  const changed = pixelmatch(expected.data, actual.data, diff.data, actual.width, actual.height, { threshold: 0.1 })
  const diffPath = join(screenshotDir, `${name}.diff.png`)
  writeFileSync(diffPath, PNG.sync.write(diff))
  const ratio = changed / (actual.width * actual.height)
  if (ratio > MAX_DIFF_RATIO) {
    throw new Error(`${name}: ${(ratio * 100).toFixed(2)}% pixels differ (limit ${MAX_DIFF_RATIO * 100}%), see ${diffPath}`)
  }
}
