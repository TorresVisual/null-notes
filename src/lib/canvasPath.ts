export function isCanvasPath(path: string): boolean {
  return path.endsWith('.canvas')
}

export function isBasePath(path: string): boolean {
  return path.endsWith('.base')
}

export function workspaceFilePath(workspace: string, relative: string): string {
  const separator = workspace.includes('\\') ? '\\' : '/'
  return `${workspace.replace(/[\\/]+$/, '')}${separator}${relative.split(/[\\/]/).join(separator)}`
}
