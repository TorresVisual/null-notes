// A canvas note is a normal .md — a heading plus a single `ink-page` fence —
// so the title, search, tags and [[links]] all keep working, and Source view
// stays an escape hatch if the canvas ever fails to load.
const FENCE_PATTERN = /```ink-page\s*\n([\s\S]*?)```/

export function canvasSrcFrom(content: string): string | null {
  const match = content.match(FENCE_PATTERN)
  if (!match) return null
  try {
    const data = JSON.parse(match[1] ?? '') as { src?: unknown }
    return typeof data.src === 'string' && data.src.length > 0 ? data.src : null
  } catch {
    return null
  }
}

export function isCanvasNote(content: string): boolean {
  return canvasSrcFrom(content) !== null
}

export function canvasNoteBody(title: string, src: string): string {
  return `# ${title}\n\n\`\`\`ink-page\n${JSON.stringify({ src })}\n\`\`\`\n`
}
