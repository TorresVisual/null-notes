import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'

// See create-note.e2e.ts / p6-academic-blocks.e2e.ts for why these exist.
async function clickInPage(selector: string): Promise<void> {
  await browser.execute((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) throw new Error(`clickInPage: no element matching ${sel}`)
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

async function runSlashCommand(query: string, title: string = query): Promise<void> {
  await browser.keys('/')
  await browser.keys(query)
  await browser.waitUntil(
    async () =>
      browser.execute((t) => {
        const items = Array.from(document.querySelectorAll('.slash-menu-item .slash-item-title'))
        return items.some((el) => el.textContent === t)
      }, title),
    { timeout: 5000, timeoutMsg: `slash menu never showed an item titled "${title}"` },
  )
  await browser.execute((t) => {
    const items = Array.from(document.querySelectorAll('.slash-menu-item'))
    const match = items.find((el) => el.querySelector('.slash-item-title')?.textContent === t)
    if (!(match instanceof HTMLElement)) throw new Error(`no slash item titled "${t}"`)
    match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  }, title)
}

describe('P6-3: templates', () => {
  it('seeds the exercise-sheet starter template, fills placeholders, and creates a note from it', async () => {
    const templatesDir = join(fixtureWorkspace, 'templates')
    // The starter template is seeded opt-in; clear it so this run always
    // exercises the empty-state seeding button rather than an existing file.
    rmSync(templatesDir, { recursive: true, force: true })
    // note_filename() maps any non-alphanumeric, non-space character to '-',
    // so the typed title stays plain ASCII to keep the resulting filename
    // predictable — the em dash in the template's own heading text is a
    // separate, unaffected thing (substituted content, not a filename).
    const notePath = join(fixtureWorkspace, 'Analysis Blatt 4.md')
    rmSync(notePath, { force: true })

    await clickButtonByText('.sidebar-new-actions button', 'Template')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.template-empty-hint')), {
      timeout: 5000,
      timeoutMsg: 'template dialog never showed the empty-state hint',
    })
    await screenshot('p6-3-template-dialog-empty')

    await clickInPage('.import-mode-option')
    await browser.waitUntil(
      async () => browser.execute(() => document.querySelectorAll('.template-list .import-mode-option').length > 0),
      { timeout: 5000, timeoutMsg: 'template list never populated after seeding' },
    )
    await screenshot('p6-3-template-dialog-list')

    await clickInPage('.template-list .import-mode-option')
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('input[name="title"]')),
      { timeout: 5000, timeoutMsg: 'placeholder form never appeared' },
    )

    // The form always asks for a note title, plus one field per {{name}}
    // the template body actually uses — course and sheet for this template.
    const fieldNames = await browser.execute(() =>
      Array.from(document.querySelectorAll('.settings-panel input[name]')).map((el) =>
        (el as HTMLInputElement).name,
      ),
    )
    expect(fieldNames).toEqual(['title', 'course', 'sheet'])
    await screenshot('p6-3-template-dialog-form')

    await browser.execute(() => document.querySelector<HTMLInputElement>('input[name="title"]')?.focus())
    await browser.keys('Analysis Blatt 4')
    await browser.execute(() => document.querySelector<HTMLInputElement>('input[name="course"]')?.focus())
    await browser.keys('Analysis II')
    await browser.execute(() => document.querySelector<HTMLInputElement>('input[name="sheet"]')?.focus())
    await browser.keys('Blatt 4')

    await browser.execute(() => {
      const buttons = Array.from(document.querySelectorAll('.settings-panel button'))
      const create = buttons.find((b) => b.textContent === 'Create')
      if (!(create instanceof HTMLElement)) throw new Error('no Create button')
      create.click()
    })

    await browser.waitUntil(() => existsSync(notePath), {
      timeout: 10000,
      interval: 300,
      timeoutMsg: `${notePath} was never created`,
    })
    const content = readFileSync(notePath, 'utf-8')
    expect(content).toContain('Analysis II — Blatt 4')
    expect(content).toContain('## Task 1')
    expect(content).toContain('### Solution')
    expect(content).not.toContain('{{course}}')
    expect(content).not.toContain('{{sheet}}')

    await screenshot('p6-3-note-from-template')
  })
})

describe('P6-4: equation snippets', () => {
  it('offers /gradient inside a block-math edit box and inserts valid LaTeX', async () => {
    const notePath = join(fixtureWorkspace, 'P6-4 Snippets.md')
    rmSync(notePath, { force: true })

    await clickButtonByText('.sidebar-new-actions button', 'Note')
    await fillPromptDialog('P6-4 Snippets')

    await focusEditorEnd()
    await browser.keys(['End', 'Enter'])
    await runSlashCommand('Block', 'Block Math')

    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.block-math-editor-input')),
      { timeout: 5000, timeoutMsg: 'block-math edit box never opened' },
    )
    // The node view's own useEffect focuses this on mount, but that can race
    // this test's next keystroke — focus it explicitly, the same fix the
    // template-dialog inputs above needed for the same reason.
    await browser.execute(() => {
      document.querySelector<HTMLTextAreaElement>('.block-math-editor-input')?.focus()
    })

    await browser.keys('/grad')
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll('.math-snippet-trigger')).some(
            (el) => el.textContent === '/gradient',
          ),
        ),
      { timeout: 5000, timeoutMsg: 'snippet menu never offered /gradient' },
    )
    await screenshot('p6-4-snippet-menu-open')

    await browser.keys('Enter')
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelector<HTMLTextAreaElement>('.block-math-editor-input')?.value,
        )) === '\\nabla f(x)',
      { timeout: 5000, timeoutMsg: 'snippet was never inserted into the draft' },
    )
    await screenshot('p6-4-snippet-inserted')

    // Ctrl+Enter commits the draft.
    await browser.keys(['Control', 'Enter'])
    await browser.waitUntil(
      async () => browser.execute(() => !document.querySelector('.block-math-editor-input')),
      { timeout: 5000, timeoutMsg: 'block-math edit box never closed after commit' },
    )
    // A parse failure would still produce a `.katex` element (KaTeX's own
    // inline error rendering, `throwOnError: false`) but tag it `.katex-error`
    // — so the real "this actually rendered" signal is katex present *and*
    // that class absent, not just katex present.
    const rendersLatex = await browser.execute(() => {
      const el = document.querySelector('.block-math-render')
      return !!el?.querySelector('.katex') && !el.querySelector('.katex-error')
    })
    expect(rendersLatex).toBe(true)
    await screenshot('p6-4-snippet-rendered')

    await browser.waitUntil(
      () => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes('\\nabla f(x)'),
      { timeout: 10000, interval: 300, timeoutMsg: `${notePath} never contained the committed LaTeX` },
    )
  })
})
