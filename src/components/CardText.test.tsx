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

