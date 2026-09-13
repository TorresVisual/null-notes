import { describe, it, expect } from 'vitest'
import { updateTauriConf, updateCargoToml } from './release.mjs'

describe('updateTauriConf', () => {
  it('replaces the version field and preserves formatting', () => {
    const input = JSON.stringify({ productName: 'null-notes', version: '0.1.0', app: {} }, null, 2) + '\n'
    const output = updateTauriConf(input, '0.2.0')
    expect(JSON.parse(output).version).toBe('0.2.0')
    expect(output).toBe(JSON.stringify({ productName: 'null-notes', version: '0.2.0', app: {} }, null, 2) + '\n')
  })
})

describe('updateCargoToml', () => {
  it('replaces only the top-level package version line', () => {
    const input = [
      '[package]',
      'name = "null-notes"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
      '[dependencies]',
      'serde = { version = "1.0", features = ["derive"] }',
      '',
    ].join('\n')
    const output = updateCargoToml(input, '0.2.0')
    expect(output).toContain('\nversion = "0.2.0"\n')
    expect(output).toContain('serde = { version = "1.0", features = ["derive"] }')
  })
})
