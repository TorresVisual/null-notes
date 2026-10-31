export interface WikiLinkParts {
  title: string
  heading: string
  label: string
}

// `Note#Heading|shown text` — every part but the title is optional. The title
// is whatever precedes the first `#` or `|`, matching notes.rs `extract_links`.
export function parseWikiLink(body: string): WikiLinkParts {
  const pipe = body.indexOf('|')
  const label = pipe < 0 ? '' : body.slice(pipe + 1).trim()
  const target = pipe < 0 ? body : body.slice(0, pipe)
  const hash = target.indexOf('#')
  return {
    title: (hash < 0 ? target : target.slice(0, hash)).trim(),
    heading: hash < 0 ? '' : target.slice(hash + 1).trim(),
    label,
  }
}

export function formatWikiLink({ title, heading, label }: WikiLinkParts): string {
  return `${title}${heading ? `#${heading}` : ''}${label ? `|${label}` : ''}`
}

export function wikiLinkText({ title, heading, label }: WikiLinkParts): string {
  return label || (heading ? `${title} › ${heading}` : title)
}
