import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RefObject } from 'react'
import { OutlinePanel } from './OutlinePanel'

function ref(el: HTMLDivElement): RefObject<HTMLDivElement | null> {
  return { current: el }
}

function mockRect(top: number): DOMRect {
  return { top, left: 0, right: 0, bottom: top, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OutlinePanel', () => {
  it('lists the headings parsed from the note content, in document order', () => {
    const { getByText } = render(
      <OutlinePanel
        content={'# Intro\n\ntext\n\n## Details\n'}
        containerRef={ref(document.createElement('div'))}
        scrollRef={ref(document.createElement('div'))}
      />,
    )

    expect(getByText('Intro')).toBeInTheDocument()
    expect(getByText('Details')).toBeInTheDocument()
  })

  it('shows an empty hint when the note has no headings', () => {
    const { getByText } = render(
      <OutlinePanel
        content={'just some prose'}
        containerRef={ref(document.createElement('div'))}
        scrollRef={ref(document.createElement('div'))}
      />,
    )

    expect(getByText('No headings in this note yet.')).toBeInTheDocument()
  })

  it('scrolls the clicked heading into view', async () => {
    const container = document.createElement('div')
    container.innerHTML = '<h1>Intro</h1><h2>Details</h2>'
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    const { getByText } = render(
      <OutlinePanel
        content={'# Intro\n\n## Details\n'}
        containerRef={ref(container)}
        scrollRef={ref(document.createElement('div'))}
      />,
    )

    await userEvent.click(getByText('Details'))

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
  })

  it('highlights the heading nearest the top of the scroll container', async () => {
    const container = document.createElement('div')
    container.innerHTML = '<h1>Intro</h1><h2>Details</h2>'
    const scroller = document.createElement('div')

    const { getByText } = render(
      <OutlinePanel content={'# Intro\n\n## Details\n'} containerRef={ref(container)} scrollRef={ref(scroller)} />,
    )

    const headingEls = Array.from(container.querySelectorAll('h1, h2')) as HTMLElement[]
    const h1 = headingEls[0]!
    const h2 = headingEls[1]!
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(mockRect(0))
    vi.spyOn(h1, 'getBoundingClientRect').mockReturnValue(mockRect(-200))
    vi.spyOn(h2, 'getBoundingClientRect').mockReturnValue(mockRect(10))

    scroller.dispatchEvent(new Event('scroll'))

    await waitFor(() => expect(getByText('Details').className).toContain('active'))
    expect(getByText('Intro').className).not.toContain('active')
  })
})
