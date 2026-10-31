import { describe, it, expect } from 'vitest'
import { isCanvasPath, workspaceFilePath } from './canvasPath'

describe('isCanvasPath', () => {
  it('matches only a trailing .canvas', () => {
    expect(isCanvasPath('a/b.canvas')).toBe(true)
    expect(isCanvasPath(String.raw`C:\ws\b.canvas`)).toBe(true)
    expect(isCanvasPath('a/b.canvas.md')).toBe(false)
    expect(isCanvasPath('a/b.md')).toBe(false)
  })
})

describe('workspaceFilePath', () => {
  it('joins with the workspace separator', () => {
    expect(workspaceFilePath('/ws', 'src/a.ts')).toBe('/ws/src/a.ts')
    expect(workspaceFilePath(String.raw`D:\ws` + '\\', 'src/a.ts')).toBe(String.raw`D:\ws\src\a.ts`)
  })
})
