// P6-3: literal find-and-replace only — no conditionals, no computed fields,
// per the roadmap's explicit "a template stays a .md file with blanks, not a
// form." A placeholder is `{{name}}`; extraction is used to build the prompt
// form, substitution is used to fill it in.
const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9_]+)\}\}/g

// Unique names, in the order they first appear — so the prompt form matches
// the order a reader would encounter them in the template.
export function extractPlaceholders(content: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const match of content.matchAll(PLACEHOLDER_RE)) {
    const name = match[1]
    if (name && !seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

export function fillTemplate(content: string, values: Record<string, string>): string {
  let result = content
  for (const [name, value] of Object.entries(values)) {
    result = result.split(`{{${name}}}`).join(value)
  }
  return result
}
