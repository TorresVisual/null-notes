import { browser } from '@wdio/globals'

/**
 * Picks an item from the editor toolbar's "Insert" dropdown. Radix opens on
 * `pointerdown`, so the trigger needs the same dispatch the sidebar "+" menu
 * does (see sidebar.ts for why this is in-page JS rather than Element#click).
 */
export async function clickInsertMenuItem(label: 'Diagram' | 'Table' | 'Code block' | 'Callout'): Promise<void> {
  await browser.execute(() => {
    const trigger = document.querySelector('[aria-label="Insert block"]')
    if (!(trigger instanceof HTMLElement)) throw new Error('toolbar Insert button not found')
    trigger.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false, pointerType: 'mouse' }),
    )
  })
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('[role="menuitem"]')), {
    timeout: 5000,
    timeoutMsg: 'the toolbar Insert menu never opened',
  })
  await browser.execute((text) => {
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent?.trim() === text)
    if (!(item instanceof HTMLElement)) throw new Error(`no Insert menu item "${text}"`)
    item.click()
  }, label)
}
