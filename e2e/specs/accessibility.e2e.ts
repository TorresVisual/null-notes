import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { newViolations, seriousViolations } from '../axe.js'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { fillPromptDialog } from '../promptDialog.js'
import { clickNewMenuItem } from '../sidebar.js'
import { expectMatchesBaseline } from '../visualBaseline.js'

// Serious/critical axe rules that already fail today, per surface. Fix one and
// delete it here; a rule not listed fails the spec.
const KNOWN: Record<'editor' | 'sidebar' | 'settings', string[]> = {
  editor: [],
  sidebar: [],
  settings: [],
}

async function expectNoNewViolations(surface: keyof typeof KNOWN, selector: string): Promise<void> {
  const found = await seriousViolations(selector)
  console.log(`axe ${surface}:`, JSON.stringify(found))
  expect(newViolations(found, KNOWN[surface])).toEqual([])
}

describe('accessibility and visual regression', () => {
  before(async () => {
    rmSync(join(fixtureWorkspace, 'A11y Note.md'), { force: true })
    await clickNewMenuItem('Note')
    await fillPromptDialog('A11y Note')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
      timeout: 5000,
      timeoutMsg: 'editor never mounted',
    })
  })

  it('editor has no new serious/critical axe violations', async () => {
    await expectNoNewViolations('editor', '.ProseMirror')
  })

  it('sidebar has no new serious/critical axe violations', async () => {
    await expectNoNewViolations('sidebar', '.sidebar')
  })

  it('settings dialog has no new serious/critical axe violations and matches its baseline', async () => {
    await browser.execute(() => {
      const el = document.querySelector('.ProseMirror')
      if (el instanceof HTMLElement) el.focus()
    })
    await browser.keys(['Control', ','])
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.settings-panel')), {
      timeout: 5000,
      timeoutMsg: 'Ctrl+, never opened the Settings dialog',
    })
    await expectNoNewViolations('settings', '.settings-panel')
    await expectMatchesBaseline('settings-panel', '.settings-panel')
  })
})
