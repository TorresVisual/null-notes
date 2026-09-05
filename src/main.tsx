import React from "react";
import ReactDOM from "react-dom/client";
import './index.css'
import 'katex/dist/katex.min.css'
import '@xterm/xterm/css/xterm.css'
import App from "./App";
import { logError } from "./lib/errorLog";
import { ErrorBoundary } from "./components/ErrorBoundary";

window.addEventListener('error', (event) => {
  logError('window-error', event.message, event.error instanceof Error ? event.error.stack : undefined)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  logError('unhandled-rejection', message, stack)
})

const originalConsoleError = console.error
console.error = (...args: unknown[]) => {
  logError('console-error', args.map(String).join(' '))
  originalConsoleError(...args)
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
