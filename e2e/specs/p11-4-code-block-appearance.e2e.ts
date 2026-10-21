import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { fixtureWorkspace } from '../fixtureWorkspace.js'
import { screenshot } from '../screenshot.js'
import { fillPromptDialog } from '../promptDialog.js'
import { clickNewMenuItem } from '../sidebar.js'

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

async function runSlashCommand(query: string, title: string = query): Promise<void> {
  await browser.keys('/')
  await browser.keys(query)
  await browser.waitUntil(
    async () =>
      browser.execute((t) => {
        const items = Array.from(document.querySelectorAll('.slash-menu-item .slash-item-title'))
        return items.some((el) => el.textContent === t)
      }, title),
    { timeout: 10000, timeoutMsg: `slash menu never showed an item titled "${title}"` },
  )
  await browser.execute((t) => {
    const items = Array.from(document.querySelectorAll('.slash-menu-item'))
    const match = items.find((el) => el.querySelector('.slash-item-title')?.textContent === t)
    if (!(match instanceof HTMLElement)) throw new Error(`no slash item titled "${t}"`)
    match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  }, title)
}

async function createNote(title: string): Promise<string> {
  const notePath = join(fixtureWorkspace, `${title}.md`)
  rmSync(notePath, { force: true })

  await clickNewMenuItem('Note')
  await fillPromptDialog(title)

  await focusEditorEnd()
  await browser.keys(['End', 'Enter'])
  return notePath
}

describe('P11-4: code block appearance (theme + font size)', () => {
  it('switching theme and font size changes a code block\'s computed styles', async () => {
    await createNote('P11-4 Appearance')

    await runSlashCommand('Code', 'Code Block')
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.note-editor pre')), {
      timeout: 5000,
      timeoutMsg: 'code block never mounted',
    })
    await browser.keys('function greet(name) {\n  return "Hello, " + name;\n}')

    const before = await browser.execute(() => {
      const pre = document.querySelector('.note-editor pre')
      const keyword = document.querySelector('.hljs-keyword, .hljs-built_in')
      return {
        fontSize: pre ? getComputedStyle(pre).fontSize : null,
        keywordColor: keyword ? getComputedStyle(keyword).color : null,
      }
    })
    expect(before.fontSize).toBe('13px')

    await browser.keys(['Control', ','])
    await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.settings-panel')), {
      timeout: 5000,
      timeoutMsg: 'settings panel never opened',
    })

    await browser.execute(() => {
      const select = [...document.querySelectorAll('select')].find((el) =>
        [...el.options].some((o) => o.value === 'one-dark'),
      )
      if (!(select instanceof HTMLSelectElement)) throw new Error('no code-theme select found')
      const setSelectValue = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
      setSelectValue?.call(select, 'one-dark')
      select.dispatchEvent(new Event('change', { bubbles: true }))

      const fontInput = [...document.querySelectorAll('input[type="number"]')].find(
        (el) => (el as HTMLInputElement).value === '13',
      )
      if (!(fontInput instanceof HTMLInputElement)) throw new Error('no code-font-size input found')
      const setInputValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setInputValue?.call(fontInput, '18')
      fontInput.dispatchEvent(new Event('input', { bubbles: true }))
      fontInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await clickInPage('.settings-panel-close')

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const pre = document.querySelector('.note-editor pre')
          return pre ? getComputedStyle(pre).fontSize === '18px' : false
        }),
      { timeout: 3000, timeoutMsg: 'code block font size never updated to 18px' },
    )

    const after = await browser.execute(() => {
      const pre = document.querySelector('.note-editor pre')
      const keyword = document.querySelector('.hljs-keyword, .hljs-built_in')
      return {
        theme: document.querySelector('.note-editor')?.getAttribute('data-code-theme'),
        fontSize: pre ? getComputedStyle(pre).fontSize : null,
        keywordColor: keyword ? getComputedStyle(keyword).color : null,
      }
    })

    expect(after.theme).toBe('one-dark')
    expect(after.fontSize).toBe('18px')
    expect(after.keywordColor).not.toBe(before.keywordColor)

    await screenshot('p11-4-one-dark-18px')
  })
})
