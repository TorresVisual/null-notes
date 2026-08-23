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

async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`clickInPage: no element matching ${sel}`)
    el.click()
  }, selector)
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

// The outline list is now hidden behind a hover (Notion-style tick marks by
// default) — a real 'mouseover' is what React's synthetic mouseenter system
// derives from, same as Testing Library's own fireEvent.mouseEnter.
async function hoverInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`hoverInPage: no element matching ${sel}`)
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  }, selector)
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

    // Outline is on by default now, so it's already mounted — exercise the
    // regression's actual trigger (mounting the panel fresh) by toggling
    // off, then back on, rather than skipping straight past it.
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.outline-panel')), {
      timeout: 5000,
      timeoutMsg: 'outline panel never rendered by default',
    })
    await toggleOutline()
    await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.outline-panel')), {
      timeout: 5000,
      timeoutMsg: 'outline panel never closed',
    })

    await toggleOutline()

    expect(await isResponsive()).toBe(true)
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.outline-panel')), {
      timeout: 5000,
      timeoutMsg: 'outline panel never reopened',
    })
    // Still responsive a moment later, not just at the instant of toggling —
    // a slow-building loop could pass the first check and hang shortly after.
    await browser.pause(1500)
    expect(await isResponsive()).toBe(true)
    await screenshot('p6-6-outline-panel-open')
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

    // Outline is on by default — no need to toggle it here.
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.outline-tick')), {
      timeout: 5000,
      timeoutMsg: 'outline tick marks never rendered',
    })
    await hoverInPage('.outline-panel')
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

  // The short fixture notes above never grow tall enough to actually show a
  // scrollbar — WebView2's overlay-mode scrollbar only paints once there's
  // real overflow, and it's specifically that overlay that's been observed
  // drawing on top of the rail rather than stopping short of it. Needs real
  // vertical overflow to mean anything.
  it('keeps the rail clear of a real vertical scrollbar on a long note', async () => {
    const notePath = await createNote('P6-6 Long Note')
    await clickInPage('.view-toggle')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.raw-editor')), {
      timeout: 5000,
      timeoutMsg: 'raw editor never opened',
    })
    await browser.execute(() => {
      const el = document.querySelector('.raw-editor')
      if (!(el instanceof HTMLTextAreaElement)) throw new Error('raw editor textarea not found')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      if (!setter) throw new Error('HTMLTextAreaElement value setter not found')
      const filler = Array.from(
        { length: 60 },
        (_, i) => `## Section ${i}\n\nEnough filler text on this line to force real vertical overflow so the outline rail sits beside an actual scrollbar, not an imaginary one.`,
      ).join('\n\n')
      setter.call(el, `# P6-6 Long Note\n\n${filler}\n`)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await browser.waitUntil(
      () => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes('Section 59'),
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never got the long filler content` },
    )

    // Outline only renders in wysiwyg mode — back out of raw view.
    await clickInPage('.view-toggle')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.outline-tick')), {
      timeout: 5000,
      timeoutMsg: 'outline tick marks never rendered on the long note',
    })
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const scroller = document.querySelector('.editor-scroll')
          return !!scroller && scroller.scrollHeight > scroller.clientHeight
        }),
      { timeout: 5000, timeoutMsg: 'the note never actually overflowed into a real scrollbar' },
    )
    // WebView2's overlay scrollbar only actually paints while scrolling (or
    // shortly after) — a scrollHeight/clientHeight mismatch alone doesn't
    // make the thumb visible for the screenshot below to mean anything.
    await browser.execute(() => document.querySelector('.editor-scroll')?.scrollBy(0, 300))
    await browser.pause(200)
    await screenshot('p6-6-outline-rail-real-scrollbar')
  })
})
