import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'

async function clickButtonByText(selector: string, text: string): Promise<void> {
  await browser.execute(
    (sel, t) => {
      const btn = Array.from(document.querySelectorAll(sel)).find((el) => el.textContent?.includes(t))
      if (!(btn instanceof HTMLElement)) throw new Error(`no ${sel} with text "${t}"`)
      btn.click()
    },
    selector,
    text,
  )
}

async function focusEditorEnd(): Promise<void> {
  await browser.execute(() => {
    const el = document.querySelector('.ProseMirror')
    if (!(el instanceof HTMLElement)) throw new Error('no element matching .ProseMirror')
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  })
}

async function createNote(title: string): Promise<string> {
  const notePath = join(fixtureWorkspace, `${title}.md`)
  rmSync(notePath, { force: true })

  await clickButtonByText('.sidebar-new-actions button', 'Note')
  await fillPromptDialog(title)
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
    timeout: 5000,
    timeoutMsg: 'editor never mounted for the new note',
  })
  return notePath
}

// WebDriver automates the WebView, not the native menu bar — see Layout.tsx's
// __e2eRunCommand for why this is how "menu-only" actions get reached here.
async function toggleOutline(): Promise<void> {
  await browser.execute(() => {
    const fn = (window as unknown as { __e2eRunCommand?: (id: string) => void }).__e2eRunCommand
    if (!fn) throw new Error('__e2eRunCommand hook missing')
    fn('toggle-outline')
  })
}

/** True if the WebView is still processing script — the regression test for
 * the freeze itself: a hung main thread never resolves this. */
async function isResponsive(): Promise<boolean> {
  return Promise.race([
    browser.execute(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000)),
  ])
}

describe('P6-6: outline panel', () => {
  it('does not freeze the app when toggled on a note with only its title heading', async () => {
    // create_note seeds "# {title}\n" — this is the shape that originally
    // froze the app: MutationObserver on the live ProseMirror DOM fed back
    // into ProseMirror's own trailing-<br> housekeeping. See the P6-6
    // postmortem in docs/ROADMAP.md.
    await createNote('P6-6 Freeze Regression')

    await toggleOutline()

    expect(await isResponsive()).toBe(true)
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.outline-panel')), {
      timeout: 5000,
      timeoutMsg: 'outline panel never rendered',
    })
    // Still responsive a moment later, not just at the instant of toggling —
    // a slow-building loop could pass the first check and hang shortly after.
    await browser.pause(1500)
    expect(await isResponsive()).toBe(true)
    await screenshot('p6-6-outline-panel-open')

    await toggleOutline()
    await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.outline-panel')), {
      timeout: 5000,
      timeoutMsg: 'outline panel never closed',
    })
  })

  it('lists real headings, highlights the one in view, and jumps on click', async () => {
    const notePath = await createNote('P6-6 Real Headings')
    await focusEditorEnd()
    await browser.keys(['End', 'Enter'])
    await browser.keys('## Second Heading')
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('h2')),
      { timeout: 5000, timeoutMsg: 'second heading never rendered' },
    )

    await toggleOutline()
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.outline-item')).some(
            (el) => el.textContent === 'Second Heading',
          ),
        ),
      { timeout: 5000, timeoutMsg: 'outline never listed the second heading' },
    )
    const items = await browser.execute(() =>
      Array.from(document.querySelectorAll('.outline-item')).map((el) => el.textContent),
    )
    expect(items).toEqual(['P6-6 Real Headings', 'Second Heading'])
    await screenshot('p6-6-outline-list')

    expect(await isResponsive()).toBe(true)

    await browser.execute(() => {
      const items = Array.from(document.querySelectorAll('.outline-item'))
      const target = items.find((el) => el.textContent === 'P6-6 Real Headings')
      if (!(target instanceof HTMLElement)) throw new Error('first outline item not found')
      target.click()
    })
    await browser.pause(500)
    expect(await isResponsive()).toBe(true)

    // Content on disk is unaffected by any of this — outline is read-only.
    await browser.waitUntil(
      () => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes('## Second Heading'),
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never contained the typed heading` },
    )
  })
})
