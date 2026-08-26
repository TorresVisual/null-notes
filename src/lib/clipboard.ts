/**
 * Writes `text` to the clipboard, falling back to a hidden-textarea
 * `execCommand('copy')` if the async Clipboard API rejects — WebView2 can
 * refuse an unfocused/background write. Shared between P11-1's code-block
 * copy button and P12-1's copy-LaTeX action rather than duplicated.
 */
export async function writeToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // fall through to the execCommand fallback below
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}
