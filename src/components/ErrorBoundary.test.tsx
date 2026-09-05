import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

vi.mock('../lib/errorLog', () => ({ logError: vi.fn() }))
import { logError } from '../lib/errorLog'

afterEach(() => cleanup())

function Boom(): never {
  throw new Error('kaboom')
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  it('renders a fallback and logs when a child throws', () => {
    // React logs the error to the console by default during this render;
    // that's expected noise, not a test failure.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      'react-boundary',
      'kaboom',
      expect.anything(),
    )
  })
})
