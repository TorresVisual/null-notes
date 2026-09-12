import { useState } from 'react'
import { FolderOpen, GitBranch, History } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace } from '../hooks/useWorkspace'
import { folderName } from '../lib/pathPrefix'
import { CloneWorkspaceDialog } from './CloneWorkspaceDialog'

export function WorkspacePicker() {
  const recents = useWorkspaceStore((s) => s.recentWorkspaces)
  const folderLoading = useWorkspaceStore((s) => s.folderLoading)
  const { openWorkspace, openWorkspaceAt } = useWorkspace()
  const [cloning, setCloning] = useState(false)

  return (
    <div className="workspace-picker">
      <img src="/favicon.svg" alt="" width={56} height={56} className="workspace-picker-mark" />
      <h1 className="workspace-picker-title">null-notes</h1>
      <p className="workspace-picker-tagline">
        WYSIWYG Markdown for CS coursework — plain <code>.md</code> files you own, not a
        database. Paste in a lecture PDF and get real, editable text and equations back, not a
        scan.
      </p>
      <p className="workspace-picker-subtitle">
        Open a folder of Markdown notes to get started.
      </p>

      {recents.length > 0 && (
        <>
          <h2 className="workspace-picker-heading">
            <History size={13} /> Recent
          </h2>
          <ul className="workspace-picker-recents">
            {recents.map((path) => (
              <li key={path}>
                <button onClick={() => void openWorkspaceAt(path)} title={path} disabled={folderLoading}>
                  <span className="workspace-picker-name">{folderName(path)}</span>
                  <span className="workspace-picker-path">{path}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <button className="workspace-picker-browse" onClick={() => void openWorkspace()} disabled={folderLoading}>
        <FolderOpen size={14} /> {folderLoading ? 'Opening…' : 'Choose a folder…'}
      </button>
      <button className="workspace-picker-clone" onClick={() => setCloning(true)} disabled={folderLoading}>
        <GitBranch size={14} /> Clone workspace…
      </button>

      {cloning && <CloneWorkspaceDialog onClose={() => setCloning(false)} />}
    </div>
  )
}
