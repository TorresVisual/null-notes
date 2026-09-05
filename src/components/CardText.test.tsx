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
})
