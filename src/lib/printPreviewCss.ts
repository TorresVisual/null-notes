// Paged.js is a CSS Paged Media polyfill — content in a margin-box string
// is CSS `content: "..."`, so a literal `"` or `\` inside the title needs
// the same escaping a CSS string literal needs.
function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

interface PageCssOptions {
  showPageNumber: boolean
  showTitle: boolean
  showDate: boolean
  title: string
  date: string
}

/**
 * WebView2's native header/footer bundles page number, title, date and URL
 * behind one on/off switch (see docs/specs/better-printing-design.md).
 * This builds the equivalent CSS Paged Media `@page` rule instead, where
 * each field really is independent.
 */
export function buildPageCss({ showPageNumber, showTitle, showDate, title, date }: PageCssOptions): string {
  const marginBoxes: string[] = []
  if (showPageNumber) {
    marginBoxes.push('@bottom-center { content: "Page " counter(page) " of " counter(pages); }')
  }
  if (showTitle) {
    marginBoxes.push(`@top-left { content: "${escapeCssString(title)}"; }`)
  }
  if (showDate) {
    marginBoxes.push(`@top-right { content: "${escapeCssString(date)}"; }`)
  }
  return `@page { size: A4; margin: 20mm;${marginBoxes.join(' ')} }`
}

export function formatPrintDate(date: Date): string {
  return date.toLocaleDateString()
}
