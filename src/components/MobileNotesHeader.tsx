import { ChevronDown, Ellipsis, FolderOpen, FolderPlus, LayoutTemplate, PenLine } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { useActionSheetStore } from '../store/actionSheet'
import { useWorkspace } from '../hooks/useWorkspace'
import { useCreateFolder } from '../hooks/useCreateFolder'
import { useCreateCanvasNote } from '../hooks/useCreateCanvasNote'
import { folderName } from '../lib/pathPrefix'
import { promptText } from '../store/promptDialog'

interface MobileNotesHeaderProps {
  onTemplateOpen: () => void
}

export function MobileNotesHeader({ onTemplateOpen }: MobileNotesHeaderProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const recentWorkspaces = useWorkspaceStore((s) => s.recentWorkspaces)
  const openSheet = useActionSheetStore((s) => s.open)
  const { openWorkspaceAt } = useWorkspace()
  const createFolder = useCreateFolder()
  const createCanvasNote = useCreateCanvasNote()

  const others = recentWorkspaces.filter((p) => p !== workspacePath)
  const name = workspacePath ? folderName(workspacePath) : ''

  async function handleCreateFolder() {
    const folder = await promptText('Folder name:')
    if (folder) await createFolder(folder)
  }

  async function handleCreateCanvas() {
    const title = await promptText('Canvas note title:')
    if (title) await createCanvasNote(title)
  }

  return (
    <div className="mobile-notes-header">
      <button
        className="mobile-notes-workspace"
        disabled={others.length === 0}
        onClick={() =>
          openSheet({
            title: 'Switch workspace',
            actions: others.map((p) => ({ label: folderName(p), icon: FolderOpen, onSelect: () => void openWorkspaceAt(p) })),
          })
        }
      >
        <FolderOpen size={16} />
        <span className="mobile-notes-workspace-name">{name}</span>
        {others.length > 0 && <ChevronDown size={16} />}
      </button>
      <button
        className="mobile-icon-btn"
        aria-label="More actions"
        onClick={() =>
          openSheet({
            title: name,
            actions: [
              {
                label: 'New folder',
                icon: FolderPlus,
                onSelect: () => void handleCreateFolder(),
              },
              {
                label: 'New canvas',
                icon: PenLine,
                onSelect: () => void handleCreateCanvas(),
              },
              { label: 'From template…', icon: LayoutTemplate, onSelect: onTemplateOpen },
            ],
          })
        }
      >
        <Ellipsis size={20} />
      </button>
    </div>
  )
}
