import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logError } from '../lib/errorLog'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logError('react-boundary', error.message, info.componentStack ?? undefined)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback">
          <p>Something went wrong. Try reloading the app.</p>
        </div>
      )
    }
    return this.props.children
  }
}
