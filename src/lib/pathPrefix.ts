// The display name of a folder: its last segment, under either separator.
// Falls back to the whole path for a drive root, which has no segment.
export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

// The folders between the workspace root and a note, outermost first —
// empty for a note at the root or one outside the workspace.
export function noteFolderSegments(notePath: string, workspace: string | null): string[] {
  if (!workspace || !isUnderPath(notePath, workspace)) return []
  return notePath
    .slice(workspace.length)
    .split(/[\\/]/)
    .filter(Boolean)
    .slice(0, -1)
}

export function isSingleSegmentName(name: string): boolean {
  return name !== '.' && name !== '..' && !/[\\/]/.test(name)
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

// A note's sidecar directory — mirrors the Rust side's `sidecar_dir_for`
// (strip the note's extension, append `.<suffix>`) so the frontend can name
// the same `.ink`/`.pdf`/`.diagrams`/`.assets` folder without a round trip.
export function sidecarDir(notePath: string, suffix: string): string {
  return notePath.replace(/\.[^./\\]+$/, `.${suffix}`)
}
