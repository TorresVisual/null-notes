import { describe, expect, it } from 'vitest'
import { takePendingHighlight } from './pendingHighlight'
import { requestCardHighlight } from './cardJump'

describe('requestCardHighlight', () => {
  it('queues the longest plain run of a Q&A front', () => {
    requestCardHighlight('/ws/a.md', 'What is **Big O** notation for sorting')
    expect(takePendingHighlight('/ws/a.md')).toMatchObject({ text: ' notation for sorting'.trim(), heading: false })
  })

  it('skips the cloze gap', () => {
    requestCardHighlight('/ws/a.md', 'The [...] is the root of a tree')
    expect(takePendingHighlight('/ws/a.md')?.text).toBe('is the root of a tree')
  })

  it('falls back to the image src for an image-only card', () => {
    requestCardHighlight('/ws/a.md', '![fig](a%20b.png "occlude=0,0,1,1")')
    expect(takePendingHighlight('/ws/a.md')).toMatchObject({ text: '', image: 'a b.png' })
  })

  it('fires the jump event for an already-open note', () => {
    let fired = false
    window.addEventListener('search:jump', () => (fired = true), { once: true })
    requestCardHighlight('/ws/a.md', 'plain question')
    expect(fired).toBe(true)
  })
})
