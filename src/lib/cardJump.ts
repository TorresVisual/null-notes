import { decodeSrc } from '../editor/extensions/NoteImage'
import { setPendingHighlight } from './pendingHighlight'

const IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/
// Everything that isn't one plain text node in the editor: images, maths, the
// cloze gap, and inline-mark syntax. A match only spans a single text node, so
// the card's longest run between these is the part that can be found.
const BREAKS_RE = /!\[[^\]]*\]\([^)]*\)|\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\[\.\.\.\]|[*_~`[\]]/g

/** Queues a flash-highlight on a card's line for a note that is being opened;
 *  the event covers a note that was already the active tab. */
export function requestCardHighlight(notePath: string, front: string): void {
  const text = front
    .split(BREAKS_RE)
    .map((run) => run.trim())
    .reduce((longest, run) => (run.length > longest.length ? run : longest), '')
  const image = IMAGE_RE.exec(front)?.[1]
  setPendingHighlight(notePath, text, false, undefined, text || !image ? undefined : decodeSrc(image))
  window.dispatchEvent(new Event('search:jump'))
}
