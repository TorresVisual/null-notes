import { describe, it, expect } from 'vitest'
import { isBasePath, isCanvasPath, workspaceFilePath } from './canvasPath'

describe('isBasePath', () => {
  it('matches only a trailing .base', () => {
    expect(isBasePath('a/x.base')).toBe(true)
    expect(isBasePath(String.raw`C:\ws\x.base`)).toBe(true)
    expect(isBasePath('a/x.basement')).toBe(false)
    expect(isBasePath('a/x.canvas')).toBe(false)
  })
})

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
