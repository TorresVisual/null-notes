import { CornerDownLeft } from 'lucide-react'
import { useWorkspace } from '../hooks/useWorkspace'
import { folderName } from '../lib/pathPrefix'
import { useWorkspaceStore } from '../store/workspace'

export function OnboardingRecents() {
  const recents = useWorkspaceStore((s) => s.recentWorkspaces)
  const folderLoading = useWorkspaceStore((s) => s.folderLoading)
  const folderError = useWorkspaceStore((s) => s.folderError)
  const { openWorkspaceAt } = useWorkspace()

  if (recents.length === 0) return null

  return (
    <section className="mobile-onboarding-recents">
      <h2 className="workspace-picker-heading">Recent</h2>
      {folderError && (
        <p className="workspace-picker-error" role="alert">
          Couldn&apos;t open that folder — {folderError}
        </p>
      )}
      <ul className="workspace-picker-recents">
        {recents.map((path) => (
          <li key={path}>
            <button onClick={() => void openWorkspaceAt(path)} title={path} disabled={folderLoading}>
              <span className="workspace-picker-name">{folderName(path)}</span>
              <span className="workspace-picker-path">{path}</span>
              <CornerDownLeft size={13} className="workspace-picker-enter" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
