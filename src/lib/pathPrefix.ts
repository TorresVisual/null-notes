export function isUnderPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}\\`)
}

export function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) return newPrefix
  if (path.startsWith(`${oldPrefix}/`) || path.startsWith(`${oldPrefix}\\`)) {
    return newPrefix + path.slice(oldPrefix.length)
  }
  return path
}
