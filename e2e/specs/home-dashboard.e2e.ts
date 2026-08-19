import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'

async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) {
      throw new Error(`clickInPage: no element matching ${sel}`)
    }
    el.click()
  }, selector)
}

function runCommand(id: string): Promise<void> {
  return browser.execute((cmdId) => {
    const w = window as unknown as { __e2eRunCommand?: (id: string) => void }
    w.__e2eRunCommand?.(cmdId)
  }, id)
}

describe('workspace dashboard', () => {
  it('the home command clears the active tab without closing it, and shows Home', async () => {
    const notePath = join(fixtureWorkspace, 'Home Dashboard Note.md')
    rmSync(notePath, { force: true })

    await clickInPage('.sidebar-new-actions button')
    // window.prompt() is a native modal outside the WebView DOM — the
    // standard WebDriver "user prompt" commands are the only way to reach it.
    await browser.waitUntil(
      async () => {
        try {
          await browser.getAlertText()
          return true
        } catch {
          return false
        }
      },
      { timeout: 5000, timeoutMsg: 'the note-title prompt() never appeared' },
    )
    await browser.sendAlertText('Home Dashboard Note')
    await browser.acceptAlert()

    await browser.waitUntil(() => existsSync(notePath), {
      timeout: 5000,
      timeoutMsg: 'note file was never created on disk',
    })
    await browser.waitUntil(
      async () => (await browser.execute(() => document.querySelectorAll('.tab.active').length)) === 1,
      { timeout: 5000, timeoutMsg: 'the new note never became the active tab' },
    )

    await runCommand('home')

    await browser.waitUntil(
      async () => (await browser.execute(() => !!document.querySelector('.home-view'))) === true,
      { timeout: 5000, timeoutMsg: 'Home view never appeared after the home command' },
    )
    const tabCount = await browser.execute(() => document.querySelectorAll('.tab').length)
    const activeTabCount = await browser.execute(() => document.querySelectorAll('.tab.active').length)
    expect(tabCount).toBeGreaterThan(0)
    expect(activeTabCount).toBe(0)

    await screenshot('p9-4-home-dashboard')

    await clickInPage('.home-section-item')

    await browser.waitUntil(
      async () => (await browser.execute(() => !document.querySelector('.home-view'))) === true,
      { timeout: 5000, timeoutMsg: 'clicking a Home item never left the Home view' },
    )
  })
})
