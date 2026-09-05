import { describe, it, expect, vi, afterEach } from 'vitest'
import { scrollToText } from './SearchModal'

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('scrollToText', () => {
  it('scrolls to and briefly highlights the first matching text node', () => {
    vi.useFakeTimers()
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    document.body.innerHTML = '<div class="note-editor"><div class="ProseMirror"><p>graph theory notes</p></div></div>'

    scrollToText('graph theory')

    const target = document.querySelector('p')!
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    expect(target.classList.contains('search-jump-target')).toBe(true)

    vi.advanceTimersByTime(1500)
    expect(target.classList.contains('search-jump-target')).toBe(false)
  })

  it('retries across frames when the editor has not mounted yet, then gives up if the text never appears', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)

    scrollToText('never appears')

    expect(raf).toHaveBeenCalledTimes(1)
  })
})
