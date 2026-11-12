import { describe, it, expect } from 'vitest'
import { settingsSummary } from './settingsSummary'
import { DEFAULT_SETTINGS } from '../store/settings'

const ctx = { settings: DEFAULT_SETTINGS, fsrsRetention: null, gitAutoCommit: false }

describe('settingsSummary', () => {
  it('shows the live editor values', () => {
    const summary = settingsSummary('editor', { ...ctx, settings: { ...DEFAULT_SETTINGS, proseFontSizePx: 18 } })
    expect(summary).toContain('Text size 18')
  })

  it('names the flashcard scheduler, with retention as a percentage for FSRS', () => {
    expect(settingsSummary('flashcards', ctx)).toBe('SM-2')
    expect(settingsSummary('flashcards', { ...ctx, fsrsRetention: 0.9 })).toBe('FSRS · 90% retention')
  })

  it('reports auto-commit state', () => {
    expect(settingsSummary('git', { ...ctx, gitAutoCommit: true })).toBe('Auto-commit on')
  })
})
