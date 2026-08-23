import { browser } from '@wdio/globals'

/**
 * Fills and submits the in-app PromptDialog (src/components/PromptDialog.tsx)
 * that now backs New Note / New Folder / New Canvas / rename — it replaced
 * window.prompt(), so WebDriver's native "user prompt" commands
 * (getAlertText/sendAlertText/acceptAlert) no longer reach it; those only
 * ever addressed the browser's own dialog.
 *
 * Sets the input via the native value setter + a real `input` event rather
 * than assigning `.value` directly — React's controlled-input tracking
 * ignores a bare property assignment, so the click below would otherwise
 * submit whatever the dialog's own default value was, not this one.
 */
export async function fillPromptDialog(value: string): Promise<void> {
  await browser.waitUntil(
    async () => browser.execute(() => !!document.querySelector('.prompt-dialog-input')),
    { timeout: 5000, timeoutMsg: 'the prompt dialog never appeared' },
  )
  await browser.execute((text) => {
    const input = document.querySelector('.prompt-dialog-input')
    if (!(input instanceof HTMLInputElement)) throw new Error('prompt dialog input not found')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (!setter) throw new Error('HTMLInputElement value setter not found')
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await browser.execute(() => {
    const btn = document.querySelector('.prompt-dialog-actions button[type="submit"]')
    if (!(btn instanceof HTMLElement)) throw new Error('prompt dialog OK button not found')
    btn.click()
  })
  // A native window.prompt()'s sendAlertText/acceptAlert round-trip used to
  // give the caller's subsequent createNote()/etc. chain a beat to start
  // before the test touched the DOM again. This in-page submit resolves
  // near-instantly by comparison, so callers that don't wait here can race
  // ahead of that chain — confirm the dialog actually closed before
  // returning control.
  await browser.waitUntil(
    async () => browser.execute(() => !document.querySelector('.prompt-dialog-input')),
    { timeout: 5000, timeoutMsg: 'the prompt dialog never closed after submit' },
  )
}
