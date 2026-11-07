import { describe, it, expect } from 'vitest'
import { updateTauriConf, updateCargoToml, assertRetaggable, assertGreenMain, resolveTargets, tagMessages, readTargets, TARGETS } from './release.mjs'

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

describe('assertGreenMain', () => {
  const sha = 'abcdef1234567890'

  it('passes for a completed successful run', () => {
    expect(() => assertGreenMain([{ status: 'completed', conclusion: 'success' }], sha)).not.toThrow()
  })

  it('refuses a missing, running or failed run', () => {
    expect(() => assertGreenMain([], sha)).toThrow(/No CI run/)
    expect(() => assertGreenMain([{ status: 'in_progress', conclusion: '' }], sha)).toThrow(/still in_progress/)
    expect(() => assertGreenMain([{ status: 'completed', conclusion: 'failure' }], sha)).toThrow(/concluded failure/)
  })
})

describe('assertRetaggable', () => {
  it('allows a missing release or a leftover draft', () => {
    expect(() => assertRetaggable(null, 'v1.0.5')).not.toThrow()
    expect(() => assertRetaggable({ isDraft: true }, 'v1.0.5')).not.toThrow()
  })

  it('refuses a published release', () => {
    expect(() => assertRetaggable({ isDraft: false }, 'v1.0.5')).toThrow(/already published/)
  })
})

describe('resolveTargets', () => {
  it('builds every target by default', () => {
    expect(resolveTargets()).toEqual(TARGETS)
  })
  it('--skip removes targets', () => {
    expect(resolveTargets({ skip: 'ios,android' })).toEqual(['windows', 'linux'])
  })
  it('--only keeps just the listed targets, in canonical order', () => {
    expect(resolveTargets({ only: 'ios,windows' })).toEqual(['windows', 'ios'])
  })
  it('rejects unknown targets, both flags, and an empty result', () => {
    expect(() => resolveTargets({ skip: 'macos' })).toThrow(/Unknown target/)
    expect(() => resolveTargets({ only: 'ios', skip: 'linux' })).toThrow(/not both/)
    expect(() => resolveTargets({ skip: TARGETS.join(',') })).toThrow(/No targets/)
  })
})

describe('tag annotation round trip', () => {
  it('writes no targets line when everything builds', () => {
    expect(tagMessages('v1.0.0', TARGETS)).toEqual(['v1.0.0'])
    expect(readTargets('v1.0.0')).toEqual(TARGETS)
  })
  it('records a partial selection and reads it back', () => {
    const messages = tagMessages('v1.0.0', ['windows', 'ios'])
    expect(messages).toEqual(['v1.0.0', 'targets: windows,ios'])
    expect(readTargets(messages.join('\n\n'))).toEqual(['windows', 'ios'])
  })
})
