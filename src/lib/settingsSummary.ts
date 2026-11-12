import { normaliseLanguage } from './spellTokens'
import type { SectionId } from '../store/settingsNav'
import type { AppSettings } from '../types'

export interface SummaryContext {
  settings: AppSettings
  fsrsRetention: number | null
  gitAutoCommit: boolean
}

export function settingsSummary(id: SectionId, { settings, fsrsRetention, gitAutoCommit }: SummaryContext): string {
  switch (id) {
    case 'editor':
      return `Text size ${settings.proseFontSizePx} · Line spacing ${settings.proseLineHeight}`
    case 'writing':
      return `Spellcheck ${settings.spellcheck ? 'on' : 'off'} · ${normaliseLanguage(settings.spellcheckLanguage) === 'de' ? 'Deutsch' : 'English'}`
    case 'flashcards':
      return fsrsRetention === null ? 'SM-2' : `FSRS · ${Math.round(fsrsRetention * 100)}% retention`
    case 'git':
      return `Auto-commit ${gitAutoCommit ? 'on' : 'off'}`
    case 'advanced':
      return 'Hidden folders · Map tiles · Error log'
    case 'about':
      return 'Version and updates'
    default:
      return ''
  }
}
