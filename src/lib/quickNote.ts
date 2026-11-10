const pad = (n: number) => String(n).padStart(2, '0')

export function quickNoteTitle(now: Date): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `Quick note ${date} ${pad(now.getHours())}-${pad(now.getMinutes())}`
}

export function isUntouchedQuickNote(title: string, markdown: string): boolean {
  const body = markdown.trim()
  return body === '' || body === `# ${title}`
}
