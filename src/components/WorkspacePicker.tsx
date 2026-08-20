import { FolderOpen, History } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace } from '../hooks/useWorkspace'
import { folderName } from '../lib/pathPrefix'

export function WorkspacePicker() {
  const recents = useWorkspaceStore((s) => s.recentWorkspaces)
  const { openWorkspace, openWorkspaceAt } = useWorkspace()

  return (
    <div className="workspace-picker">
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
                <button onClick={() => void openWorkspaceAt(path)} title={path}>
                  <span className="workspace-picker-name">{folderName(path)}</span>
                  <span className="workspace-picker-path">{path}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <button className="workspace-picker-browse" onClick={() => void openWorkspace()}>
        <FolderOpen size={14} /> Choose a folder…
      </button>
    </div>
  )
}
