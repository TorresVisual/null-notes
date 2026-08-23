import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RefObject } from 'react'
import { OutlinePanel } from './OutlinePanel'

function ref(el: HTMLDivElement): RefObject<HTMLDivElement | null> {
  return { current: el }
}

// Cursor-tracking reads document.getSelection(), which only reliably targets
// nodes that are actually part of the visible document — a detached
// container (fine for every other test here, which never touches selection)
// isn't enough for these.
function attachedContainer(html: string): HTMLDivElement {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

function placeCursorIn(node: Node, offset = 0): void {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('OutlinePanel', () => {
  it('shows unlabeled tick marks, one per heading, before hovering', () => {
    const { container, queryByText } = render(
      <OutlinePanel
        content={'# Intro\n\ntext\n\n## Details\n'}
        containerRef={ref(document.createElement('div'))}
      />,
    )

    expect(container.querySelectorAll('.outline-tick')).toHaveLength(2)
    expect(queryByText('Intro')).not.toBeInTheDocument()
    expect(queryByText('Details')).not.toBeInTheDocument()
  })

  it('lists the headings parsed from the note content, in document order, once hovered', () => {
    const { getByText, container } = render(
      <OutlinePanel
        content={'# Intro\n\ntext\n\n## Details\n'}
        containerRef={ref(document.createElement('div'))}
      />,
    )

    fireEvent.mouseEnter(container.querySelector('.outline-panel')!)

    expect(getByText('Intro')).toBeInTheDocument()
    expect(getByText('Details')).toBeInTheDocument()
  })

  it('hides the flyout again on mouse leave', () => {
    const { getByText, queryByText, container } = render(
      <OutlinePanel content={'# Intro\n'} containerRef={ref(document.createElement('div'))} />,
    )
    const panel = container.querySelector('.outline-panel')!

    fireEvent.mouseEnter(panel)
    expect(getByText('Intro')).toBeInTheDocument()

    fireEvent.mouseLeave(panel)
    expect(queryByText('Intro')).not.toBeInTheDocument()
  })

  it('shows an empty hint when the note has no headings, once hovered', () => {
    const { getByText, container } = render(
      <OutlinePanel content={'just some prose'} containerRef={ref(document.createElement('div'))} />,
    )

    fireEvent.mouseEnter(container.querySelector('.outline-panel')!)

    expect(getByText('No headings in this note yet.')).toBeInTheDocument()
  })

  it('scrolls the clicked heading into view', async () => {
    const user = userEvent.setup()
    const container = document.createElement('div')
    container.innerHTML = '<h1>Intro</h1><h2>Details</h2>'
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    const { getByText, container: root } = render(
      <OutlinePanel content={'# Intro\n\n## Details\n'} containerRef={ref(container)} />,
    )

    fireEvent.mouseEnter(root.querySelector('.outline-panel')!)
    await user.click(getByText('Details'))

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
  })

  it('highlights the heading the cursor currently sits in', async () => {
    const container = attachedContainer('<h1>Intro</h1><h2>Details</h2><p>body text</p>')

    const { container: root } = render(
      <OutlinePanel content={'# Intro\n\n## Details\n\nbody text\n'} containerRef={ref(container)} />,
    )
    // Text queries are scoped to the panel's own root, not document.body —
    // the raw note content above (attachedContainer) also has an "Intro"/
    // "Details" heading of its own, and an unscoped query would match both.
    const panel = within(root)
    fireEvent.mouseEnter(root.querySelector('.outline-panel')!)

    placeCursorIn(container.querySelector('p')!.firstChild!, 0)

    await waitFor(() => expect(panel.getByText('Details').className).toContain('active'))
    expect(panel.getByText('Intro').className).not.toContain('active')
  })

  it('moves the highlight back when the cursor moves back to an earlier heading', async () => {
    const container = attachedContainer('<h1>Intro</h1><h2>Details</h2><p>body text</p>')

    const { container: root } = render(
      <OutlinePanel content={'# Intro\n\n## Details\n\nbody text\n'} containerRef={ref(container)} />,
    )
    const panel = within(root)
    fireEvent.mouseEnter(root.querySelector('.outline-panel')!)

    placeCursorIn(container.querySelector('p')!.firstChild!, 0)
    await waitFor(() => expect(panel.getByText('Details').className).toContain('active'))

    placeCursorIn(container.querySelector('h1')!.firstChild!, 0)

    await waitFor(() => expect(panel.getByText('Intro').className).toContain('active'))
    expect(panel.getByText('Details').className).not.toContain('active')
  })
})
