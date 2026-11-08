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

/** Paged.js lays a note out by measuring it, and measuring only works while
 *  the mount is rendered. Parked at a large negative `left` it pushes a blank
 *  first page and then lays the first page out twice (25 pages for a note the
 *  preview paginates into 20); parked at the origin, `visibility: hidden`
 *  keeps layout but paints nothing. The width is the A4 sheet so wrapping
 *  matches what is printed. */
const MEASURING_STYLE = 'position: absolute; left: 0; top: 0; width: 210mm; visibility: hidden; z-index: -1;'

/**
 * Paginates `content` into a bare `#print-root` on `document.body`, hides
 * everything else with `body.printing`, runs `run` (the actual print job),
 * then tears it all down. Printing from here instead of from the preview
 * dialog means the job sees nothing but the page stack — no fixed
 * positioning, centring transforms or clipped scroll pane to undo.
 *
 * The mount is measured in place (`display: none` would measure nothing) and
 * switched into normal flow before `run`.
 */
export async function withPrintMount<T>(
  content: HTMLElement,
  pageCss: string,
  run: () => Promise<T>,
): Promise<T> {
  const mount = document.createElement('div')
  mount.id = 'print-root'
  mount.style.cssText = MEASURING_STYLE
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

/** Code blocks up to this many lines stay on one page; longer ones split so a
 *  page is never left mostly empty waiting for a big block to fit. */
const KEEP_TOGETHER_MAX_LINES = 8

/**
 * Paged.js only honours `break-after: avoid` through `data-break-after` /
 * `data-previous-break-after` attributes (it builds them itself from the
 * stylesheets it is handed, which never include the app's own CSS), so
 * "keep with next" is applied to the clone directly: headings and any
 * paragraph that introduces a code block stay on the page of what follows.
 * Short code blocks are tagged for `break-inside: avoid` in `index.css`.
 */
export function markPageBreaks(root: HTMLElement): void {
  const keepWithNext = (el: Element) => {
    const next = el.nextElementSibling
    if (!next) return
    el.setAttribute('data-break-after', 'avoid')
    next.setAttribute('data-previous-break-after', 'avoid')
  }
  root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(keepWithNext)
  root.querySelectorAll('p').forEach((p) => {
    if (p.nextElementSibling?.tagName === 'PRE') keepWithNext(p)
  })
  root.querySelectorAll('pre').forEach((pre) => {
    // Paged.js drops whitespace-only text nodes from the continuation of a
    // block it splits across pages — the spaces between highlighted tokens,
    // indentation and the newlines of blank lines — so the second half of a
    // long block comes out run together. A zero-width space makes each such
    // node "non-empty" without changing how it looks.
    const texts = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT)
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      if (!node.nodeValue?.trim()) node.nodeValue += '​'
    }
    const lines = (pre.textContent?.match(/\n/g)?.length ?? 0) + 1
    if (lines <= KEEP_TOGETHER_MAX_LINES) pre.setAttribute('data-keep-together', '')
  })
}

function printInk(hex: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const full = (m[1] ?? '').length === 3 ? (m[1] ?? '').replace(/./g, '$&$&') : (m[1] ?? '')
  const n = parseInt(full, 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (l <= 0.5) return hex
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  const hue = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  const nl = 1 - l
  const a = s * Math.min(nl, 1 - nl)
  const channel = (k: number) => {
    const t = (k + hue * 2) % 12
    return Math.round((nl - a * Math.max(-1, Math.min(t - 3, 9 - t, 1))) * 255)
  }
  return '#' + [channel(0), channel(8), channel(4)].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** Pens are tuned for the dark editor (near-white ink), which vanishes on a
 *  white page. Recolouring the SVG instead of CSS-inverting it keeps the
 *  strokes vector in the PDF. */
export function adaptInkForPrint(root: HTMLElement): void {
  root.querySelectorAll('.ink-preview-page [fill], .ink-preview-page [stroke]').forEach((el) => {
    for (const attr of ['fill', 'stroke']) {
      const value = el.getAttribute(attr)
      if (value) el.setAttribute(attr, printInk(value))
    }
  })
}
