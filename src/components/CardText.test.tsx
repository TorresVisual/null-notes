import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { CardText } from './CardText'
import { api } from '../lib/tauri'

vi.mock('../lib/tauri', () => ({
  api: {
    assets: {
      read: vi.fn(),
    },
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CardText', () => {
  it('renders plain text with no image markdown as-is', () => {
    render(<CardText text="What is the capital of France?" notePath="/ws/a.md" />)
    expect(screen.getByText('What is the capital of France?')).toBeInTheDocument()
  })

  it('resolves an inline image and renders it', async () => {
    vi.mocked(api.assets.read).mockResolvedValue('YmFzZTY0')
    render(<CardText text="Name this organelle: ![organelle](Note.assets/a.png)" notePath="/ws/a.md" />)
    expect(screen.getByText(/Name this organelle/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByAltText('organelle')).toBeInTheDocument())
    expect(screen.getByAltText('organelle')).toHaveAttribute('src', 'data:image;base64,YmFzZTY0')
    expect(api.assets.read).toHaveBeenCalledWith('/ws/a.md', 'Note.assets/a.png')
  })

  // Regression: markdown from a note whose sidecar folder has a space
  // (e.g. "Lecture 7.assets/") encodes it as %20 — NoteImage's own view
  // decodes that back before reading, so the card view must too, or every
  // such note's images "work" while editing but show missing in review.
  it('decodes a space-encoded path before resolving it', async () => {
    vi.mocked(api.assets.read).mockResolvedValue('YmFzZTY0')
    render(<CardText text="![fig](Lecture%207.assets/a.png)" notePath="/ws/Lecture 7.md" />)
    await waitFor(() => expect(screen.getByAltText('fig')).toBeInTheDocument())
    expect(api.assets.read).toHaveBeenCalledWith('/ws/Lecture 7.md', 'Lecture 7.assets/a.png')
  })

  it('shows a missing-image fallback when the read fails', async () => {
    vi.mocked(api.assets.read).mockRejectedValue(new Error('not found'))
    render(<CardText text="![gone](Note.assets/missing.png)" notePath="/ws/a.md" />)
    await waitFor(() => expect(screen.getByText(/Missing image/)).toBeInTheDocument())
  })

  it('hides the region on an occlusion front and outlines it on the back', async () => {
    vi.mocked(api.assets.read).mockResolvedValue('YmFzZTY0')
    const front = render(
      <CardText text={'![fig](Note.assets/a.png "occlude=0.1,0.2,0.3,0.4")'} notePath="/ws/a.md" />,
    )
    await waitFor(() => expect(screen.getByAltText('fig')).toBeInTheDocument())
    expect(api.assets.read).toHaveBeenCalledWith('/ws/a.md', 'Note.assets/a.png')
    const hidden = screen.getByTestId('occlusion-occlude')
    expect(hidden).toHaveStyle({ left: '10%', top: '20%', width: '30%', height: '40%' })
    expect(screen.queryByTestId('occlusion-reveal')).toBeNull()
    front.unmount()

    render(<CardText text={'![fig](Note.assets/a.png "reveal=0.1,0.2,0.3,0.4")'} notePath="/ws/a.md" />)
    await waitFor(() => expect(screen.getByTestId('occlusion-reveal')).toBeInTheDocument())
    expect(screen.queryByTestId('occlusion-occlude')).toBeNull()
  })

  it('gives an svg diagram its own image type so it renders', async () => {
    vi.mocked(api.assets.read).mockResolvedValue('PHN2Zy8+')
    render(<CardText text="![diagram](Note.diagrams/d.svg)" notePath="/ws/a.md" />)
    await waitFor(() => expect(screen.getByAltText('diagram')).toBeInTheDocument())
    expect(screen.getByAltText('diagram')).toHaveAttribute('src', 'data:image/svg+xml;base64,PHN2Zy8+')
  })

  it('renders an image with an ordinary title and no overlay', async () => {
    vi.mocked(api.assets.read).mockResolvedValue('YmFzZTY0')
    const { container } = render(<CardText text={'![fig](Note.assets/a.png "a title")'} notePath="/ws/a.md" />)
    await waitFor(() => expect(screen.getByAltText('fig')).toBeInTheDocument())
    expect(container.querySelector('.occlusion-box')).toBeNull()
  })

  it('renders inline math through KaTeX', () => {
    const { container } = render(<CardText text="Compute $\\int_0^1 x^2\\,dx$ to proceed" notePath="/ws/a.md" />)
    expect(screen.getByText(/Compute/)).toBeInTheDocument()
    expect(screen.getByText(/to proceed/)).toBeInTheDocument()
    const mathSpan = container.querySelector('.inline-math-render')
    expect(mathSpan).toBeInTheDocument()
    expect(mathSpan?.querySelector('.katex')).toBeInTheDocument()
  })

  it('renders display math through KaTeX in display mode', () => {
    const { container } = render(<CardText text="$$e^{i\\pi} + 1 = 0$$" notePath="/ws/a.md" />)
    const mathSpan = container.querySelector('.block-math-render')
    expect(mathSpan).toBeInTheDocument()
    expect(mathSpan?.querySelector('.katex-display')).toBeInTheDocument()
  })

  it('renders mixed math and image spans in the correct order', async () => {
    vi.mocked(api.assets.read).mockResolvedValue('YmFzZTY0')
    const { container } = render(
      <CardText
        text="Formula: $E = mc^2$ and illustration: ![diagram](Note.assets/diag.png)"
        notePath="/ws/a.md"
      />,
    )
    expect(screen.getByText(/Formula:/)).toBeInTheDocument()
    expect(container.querySelector('.inline-math-render')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByAltText('diagram')).toBeInTheDocument())
  })

  it('renders multiple inline math equations', () => {
    const { container } = render(<CardText text="If $a = 1$ and $b = 2$, then $a + b = 3$" notePath="/ws/a.md" />)
    const mathSpans = container.querySelectorAll('.inline-math-render')
    expect(mathSpans.length).toBe(3)
  })
})

