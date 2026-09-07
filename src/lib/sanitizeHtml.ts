import DOMPurify from 'dompurify'

// Raw HTML preserved from notes (Git pull / Syncthing / shared folders) is untrusted.
// iframe/object/embed/script are forbidden outright rather than attribute-filtered:
// iframe's `srcdoc` is a nested HTML document DOMPurify does not sanitize, so any
// attribute-level filtering on the tag itself would still let it execute.
export function sanitizeNoteHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  })
}
