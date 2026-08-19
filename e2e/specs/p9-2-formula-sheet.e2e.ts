import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'

async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`no element matching ${sel}`)
    el.click()
  }, selector)
}

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

  await clickButtonByText('.sidebar-new-actions button', 'New Note')
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
  await browser.sendAlertText(title)
  await browser.acceptAlert()
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.ProseMirror')), {
    timeout: 5000,
    timeoutMsg: 'editor never mounted for the new note',
  })
  return notePath
}

async function waitForSavedContent(notePath: string, needle: string): Promise<void> {
  await browser.waitUntil(() => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes(needle), {
    timeout: 10000,
    interval: 300,
    timeoutMsg: `${notePath} never contained "${needle}"`,
  })
}

// The block-math editor (opened from the `/` slash menu) is built for one
// formula at a time with live KaTeX preview — not the tool for laying down a
// whole fixture note with headings and duplicate formulas. Raw/source view,
// already the supported way to set content the WYSIWYG has no input for
// (P6-7's e2e spec does the same for callout syntax), sets the exact
// markdown `extract_formulas` reads directly.
async function setRawContent(content: string): Promise<void> {
  // Idempotent and retried, not a single click-then-wait: right after a tab
  // is created/activated, TabBar's extra buttons (SaveStatus, view-toggle)
  // can still be settling, and a click that lands between renders is
  // silently lost. Checking for `.raw-editor` before each click (rather than
  // clicking unconditionally on every retry) avoids toggling back to wysiwyg
  // if an earlier click actually landed.
  await browser.waitUntil(
    async () => {
      if (await browser.execute(() => !!document.querySelector('.raw-editor'))) return true
      await clickInPage('.view-toggle')
      return false
    },
    { timeout: 8000, interval: 400, timeoutMsg: 'raw editor never opened after clicking .view-toggle' },
  )
  await browser.execute((text) => {
    const el = document.querySelector('.raw-editor') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, content)
}

async function openFormulaSheetPrompt(): Promise<void> {
  await browser.execute(() => {
    const fn = (window as unknown as { __e2eRunCommand?: (id: string) => void }).__e2eRunCommand
    if (!fn) throw new Error('__e2eRunCommand hook missing')
    fn('generate-formula-sheet')
  })
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.formula-sheet-prompt')), {
    timeout: 5000,
    timeoutMsg: 'formula sheet prompt never rendered',
  })
}

// The fixture workspace is shared with every other spec (see fixtureWorkspace.ts)
// and several of them leave their own block-math notes behind — a blank,
// whole-workspace query would correctly (and unhelpfully, for a deterministic
// assertion) pick those up too. `folder:` matches anywhere in a note's path,
// including the filename, so scoping to the P9-2 notes' own name prefix
// isolates this test without needing a real subfolder.
async function setScopeQuery(query: string): Promise<void> {
  await browser.execute((text) => {
    const el = document.querySelector('.formula-sheet-prompt-input') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, query)
}

describe('P9-2: formula sheet generation', () => {
  it('collects block math across a folder scope, deduplicated and grouped, into an editable note', async () => {
    const sheetPath = join(fixtureWorkspace, 'Formula Sheet - P9-2.md')
    rmSync(sheetPath, { force: true })

    const alphaPath = await createNote('P9-2 Alpha')
    await focusEditorEnd()
    await setRawContent('# P9-2 Alpha\n\n## Eigenvalues\n\n$$Av = \\lambda v$$\n\n$$Av = \\lambda v$$\n')
    await waitForSavedContent(alphaPath, 'Av = \\lambda v')

    const betaPath = await createNote('P9-2 Beta')
    await focusEditorEnd()
    await setRawContent('# P9-2 Beta\n\n$$E = mc^2$$\n')
    await waitForSavedContent(betaPath, 'E = mc^2')

    await openFormulaSheetPrompt()
    await setScopeQuery('folder:P9-2')
    await screenshot('p9-2-formula-sheet-prompt')
    await clickButtonByText('.formula-sheet-prompt-actions button', 'Generate')

    await browser.waitUntil(
      async () =>
        browser.execute(() => document.querySelector('.tab.active button')?.textContent === 'Formula Sheet - P9-2'),
      { timeout: 10000, timeoutMsg: 'generating never opened a "Formula Sheet - P9-2" tab' },
    )
    await browser.waitUntil(async () => browser.execute(() => !document.querySelector('.formula-sheet-prompt')), {
      timeout: 5000,
      timeoutMsg: 'the formula sheet prompt never closed after generating',
    })

    await browser.waitUntil(() => existsSync(sheetPath), {
      timeout: 5000,
      timeoutMsg: `${sheetPath} was never created`,
    })
    const sheet = readFileSync(sheetPath, 'utf-8')
    expect(sheet).toBe(
      '# Formula Sheet - P9-2\n\n## P9-2 Alpha\n\n### Eigenvalues\n\n$\nAv = \\lambda v\n$\n\n## P9-2 Beta\n\n$\nE = mc^2\n$\n',
    )
    await screenshot('p9-2-formula-sheet-generated')

    // A generated sheet is an ordinary note from here on: editable, and
    // regenerating with the same scope refuses rather than overwriting it.
    await openFormulaSheetPrompt()
    await setScopeQuery('folder:P9-2')
    await clickButtonByText('.formula-sheet-prompt-actions button', 'Generate')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.formula-sheet-prompt-error')), {
      timeout: 5000,
      timeoutMsg: 'regenerating over an existing sheet never surfaced a collision error',
    })
  })
})
