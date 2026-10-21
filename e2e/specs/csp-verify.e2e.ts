import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { fillPromptDialog } from '../promptDialog.js'
import { clickNewMenuItem } from '../sidebar.js'
import { screenshot } from '../screenshot.js'

async function focusElement(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`focusElement: no element matching ${sel}`)
    el.focus()
  }, selector)
}

// A 1x1 transparent GIF, chosen over a real screenshot-worthy image because
// only the URI scheme (data:) matters for the img-src CSP directive under
// test, not the pixels.
const ONE_PX_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

// tauri.conf.json's app.security.csp was `null` until this change (H-1,
// docs/security-audit-2026-09-07.md) — a real policy risks silently breaking
// KaTeX/Mermaid/remote-image rendering or the Tailwind/shadcn dialog chrome,
// which a unit test can't see because CSP is only enforced by the actual
// WebView, not jsdom. This drives the real compiled app and listens for
// `securitypolicyviolation` events (the same signal DevTools' "Refused to…"
// console lines come from) across every block type the audit called out.
describe('Content-Security-Policy does not break existing rendering', () => {
  it('renders math, mermaid, a data: image, and a dialog with zero CSP violations', async () => {
    const notePath = join(fixtureWorkspace, 'CSP Verify.md')
    rmSync(notePath, { force: true })

    await browser.execute(() => {
      ;(window as unknown as { __cspViolations: string[] }).__cspViolations = []
      document.addEventListener('securitypolicyviolation', (e) => {
        ;(window as unknown as { __cspViolations: string[] }).__cspViolations.push(
          `${e.violatedDirective}: ${e.blockedURI}`,
        )
      })
    })

    await clickNewMenuItem('Note')
    await fillPromptDialog('CSP Verify')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
      timeout: 5000,
      timeoutMsg: 'new note never opened in wysiwyg view',
    })

    await focusElement('.ProseMirror')
    await browser.keys(['Control', 'e'])
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.raw-editor')), {
      timeout: 5000,
      timeoutMsg: 'Ctrl+E never switched the note into raw view',
    })

    const markdown = [
      '# CSP Verify',
      '',
      '$$x^2 + y^2 = z^2$$',
      '',
      '```mermaid',
      'graph TD',
      '    A --> B',
      '```',
      '',
      `![test](${ONE_PX_GIF})`,
      '',
    ].join('\n')

    await browser.execute((text) => {
      const textarea = document.querySelector('.raw-editor')
      if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('raw editor textarea not found')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      if (!setter) throw new Error('HTMLTextAreaElement value setter not found')
      setter.call(textarea, text)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    }, markdown)

    await focusElement('.raw-editor')
    await browser.keys(['Control', 'e'])
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
      timeout: 5000,
      timeoutMsg: 'Ctrl+E never switched the note back to wysiwyg view',
    })

    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.block-math .katex')), {
      timeout: 5000,
      timeoutMsg: 'KaTeX never rendered the block math',
    })
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.mermaid-block svg')), {
      timeout: 10000,
      timeoutMsg: 'Mermaid never rendered its SVG',
    })
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const img = document.querySelector('.note-image img')
          return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0
        }),
      { timeout: 5000, timeoutMsg: 'the data: image never loaded' },
    )

    await focusElement('.ProseMirror')
    await browser.keys(['Control', ','])
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.settings-panel')), {
      timeout: 5000,
      timeoutMsg: 'Ctrl+, never opened the Settings dialog',
    })

    await screenshot('csp-verify-settings-open')

    const violations = await browser.execute(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    )
    expect(violations).toEqual([])

    expect(existsSync(notePath)).toBe(true)
  })
})
