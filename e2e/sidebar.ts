import { browser } from '@wdio/globals'

/**
 * Creates via the sidebar header's "+" menu (src/components/SidebarHeader.tsx),
 * which replaced the old always-visible Note/Folder/Canvas/Template button grid.
 *
 * Radix opens a dropdown on `pointerdown`, not `click`, so a plain in-page
 * `.click()` on the trigger — the pattern every spec used on the old grid —
 * never opens it. Dispatch the pointerdown, wait for the items to mount, then
 * click the item by its label.
 *
 * Everything is dispatched as plain in-page JS rather than WebdriverIO's
 * Element#click(): that runs its own overlap/visibility readiness check, and
 * through @wdio/tauri-service's driverProvider each iteration is a slow round
 * trip — a near-instant UI state becomes a 10-20s stall per click. The element
 * already exists by the time it is resolved, which is sufficient readiness.
 */
export async function clickNewMenuItem(label: 'Note' | 'Folder' | 'Canvas' | 'From template'): Promise<void> {
  // The app opens the --workspace folder asynchronously after launch, and the
  // create handlers close over the workspace path from the render the menu was
  // clicked in — a click before it finishes silently creates nothing.
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const name = document.querySelector('.sidebar-workspace-name')?.textContent
        return !!name && name !== 'Open Workspace' && name !== 'Opening…'
      }),
    { timeout: 15000, timeoutMsg: 'the fixture workspace never finished opening' },
  )
  await browser.execute(() => {
    const trigger = document.querySelector('.sidebar-new')
    if (!(trigger instanceof HTMLElement)) throw new Error('sidebar "+" button not found')
    trigger.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false, pointerType: 'mouse' }),
    )
  })
  await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('[role="menuitem"]')), {
    timeout: 5000,
    timeoutMsg: 'the sidebar "+" menu never opened',
  })
  await browser.execute((text) => {
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) =>
      el.textContent?.trim().startsWith(text),
    )
    if (!(item instanceof HTMLElement)) throw new Error(`no "+" menu item starting with "${text}"`)
    item.click()
  }, label)
}
