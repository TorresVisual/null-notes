import { Previewer } from 'pagedjs'

/** A `Previewer` outlives the promise `preview()` returns: every page it
 *  built keeps a `ResizeObserver` on its own wrapper, and its `Polisher`
 *  keeps the `<style>` tags it appended to `<head>`. Emptying the container
 *  without this fires those observers against pages whose content is gone —
 *  `checkUnderflowAfterResize` then walks off the end of the tree and throws
 *  `Cannot read properties of null (reading 'nextSibling')`. */
export function teardown(previewer: Previewer): void {
  previewer.chunker.stop()
  previewer.chunker.removePages()
  previewer.polisher.destroy()
}

/**
 * Paginates `content` into a bare `#print-root` on `document.body`, hides
 * everything else with `body.printing`, runs `run` (the actual print job),
 * then tears it all down. Printing from here instead of from the preview
 * dialog means the job sees nothing but the page stack — no fixed
 * positioning, centring transforms or clipped scroll pane to undo.
 *
 * The mount sits off-screen while Paged.js measures it (`display: none`
 * would measure nothing) and is switched into normal flow before `run`.
 */
export async function withPrintMount<T>(
  content: HTMLElement,
  pageCss: string,
  run: () => Promise<T>,
): Promise<T> {
  const mount = document.createElement('div')
  mount.id = 'print-root'
  mount.style.cssText = 'position: absolute; left: -100000px; top: 0;'
  document.body.appendChild(mount)
  const previewer = new Previewer()
  try {
    await previewer.preview(content, [{ [window.location.href]: pageCss }], mount)
    mount.removeAttribute('style')
    document.body.classList.add('printing')
    return await run()
  } finally {
    document.body.classList.remove('printing')
    teardown(previewer)
    mount.remove()
  }
}
