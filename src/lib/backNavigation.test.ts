import { describe, it, expect } from 'vitest'
import { resolveBack, type BackState } from './backNavigation'

const idle: BackState = { overlayOpen: false, sheetOpen: false, onboardingStep: false, editorOpen: false, noteHistory: false, tab: 'home' }

describe('resolveBack', () => {
  it('closes an overlay before anything else', () => {
    expect(resolveBack({ overlayOpen: true, sheetOpen: true, onboardingStep: true, editorOpen: true, noteHistory: true, tab: 'notes' })).toBe('close-overlay')
  })
  it('closes the sheet before the editor', () => {
    expect(resolveBack({ ...idle, sheetOpen: true, editorOpen: true, tab: 'notes' })).toBe('close-sheet')
  })
  it('steps back out of an onboarding screen before exiting', () => {
    expect(resolveBack({ ...idle, onboardingStep: true })).toBe('leave-onboarding-step')
  })
  it('steps back through note history before closing the editor', () => {
    expect(resolveBack({ ...idle, editorOpen: true, noteHistory: true, tab: 'notes' })).toBe('previous-note')
  })
  it('closes the editor before leaving the tab', () => {
    expect(resolveBack({ ...idle, editorOpen: true, tab: 'notes' })).toBe('close-editor')
  })
  it('returns to Home from a non-Home tab', () => {
    expect(resolveBack({ ...idle, tab: 'notes' })).toBe('go-home')
  })
  it('exits from idle Home', () => {
    expect(resolveBack(idle)).toBe('exit')
  })
})
