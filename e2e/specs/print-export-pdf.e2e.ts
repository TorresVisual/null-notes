import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../fixtures/print-export-note.md')

// Skia writes uncompressed page objects, so counting them is enough to tell
// whether the PDF has the same number of pages as the preview showed.
function pdfPageCount(path: string): number {
  return (readFileSync(path, 'latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

describe('export to PDF', () => {
  it('prints exactly the pages the preview shows, with nothing wider than a page', async () => {
    copyFileSync(source, join(fixtureWorkspace, 'Print Export Fixture.md'))

    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.sidebar-new')), {
      timeout: 15000,
    })
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const row = Array.from(document.querySelectorAll('.tree-note .tree-label')).find(
            (el) => el.textContent === 'Print Export Fixture',
          )
          if (!(row instanceof HTMLElement)) return false
          row.click()
          return true
        }),
      { timeout: 15000, timeoutMsg: 'the note never appeared in the sidebar' },
    )
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror pre')), {
      timeout: 15000,
    })

    await browser.execute(() => {
      const fn = (window as unknown as { __e2eRunCommand?: (id: string) => void }).__e2eRunCommand
      if (!fn) throw new Error('__e2eRunCommand hook missing')
      fn('export-pdf')
    })
    await browser.waitUntil(
      async () => browser.execute(() => document.querySelectorAll('.print-preview-pages .pagedjs_page').length > 3),
      { timeout: 60000, timeoutMsg: 'preview never paginated' },
    )
    await browser.pause(3000)

    const previewPages = await browser.execute(
      () => document.querySelectorAll('.print-preview-pages .pagedjs_page').length,
    )
    const overflowingTables = await browser.execute(
      () =>
        Array.from(document.querySelectorAll('.print-preview-pages table')).filter((table) => {
          const page = table.closest('.pagedjs_page_content')
          return page !== null && table.getBoundingClientRect().width > page.getBoundingClientRect().width + 1
        }).length,
    )

    const out = resolve(here, '../.artifacts')
    mkdirSync(out, { recursive: true })
    const pdfPath = join(out, 'print-export-pdf.pdf')
    rmSync(pdfPath, { force: true })
    await browser.execute((p) => {
      ;(window as unknown as { __e2eSavePath?: string }).__e2eSavePath = p
      const btn = document.querySelector('.formula-sheet-prompt-actions .dialog-action-primary')
      if (!(btn instanceof HTMLElement)) throw new Error('export button missing')
      btn.click()
    }, pdfPath)
    await browser.waitUntil(async () => existsSync(pdfPath), { timeout: 60000, timeoutMsg: 'PDF never written' })
    await browser.pause(1500)

    expect(overflowingTables).toBe(0)
    expect(pdfPageCount(pdfPath)).toBe(previewPages)
  })
})
