// The display name of a folder: its last segment, under either separator.
// Falls back to the whole path for a drive root, which has no segment.
export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

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
