import { describe, expect, it } from 'vitest'
import { failure } from './failure'

describe('failure', () => {
  it('names the action and the cause for Error and string rejections', () => {
    expect(failure('save settings', new Error('disk full'))).toBe("Couldn't save settings: disk full")
    expect(failure('empty the trash', 'permission denied')).toBe("Couldn't empty the trash: permission denied")
  })
})
