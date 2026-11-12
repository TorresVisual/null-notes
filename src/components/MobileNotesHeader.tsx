import { ArrowLeftRight, ChevronDown, Ellipsis, FolderOpen, FolderPlus, LayoutTemplate, PenLine, Trash2 } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { useActionSheetStore } from '../store/actionSheet'
import { useWorkspace } from '../hooks/useWorkspace'
import { useDeleteLocalWorkspace } from '../hooks/useDeleteLocalWorkspace'
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
  const { openWorkspaceAt, closeWorkspace } = useWorkspace()
  const createFolder = useCreateFolder()
  const createCanvasNote = useCreateCanvasNote()
  const deleteLocalCopy = useDeleteLocalWorkspace()

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
        onClick={() =>
          openSheet({
            title: 'Switch workspace',
            actions: [
              ...others.map((p) => ({ label: folderName(p), icon: FolderOpen, onSelect: () => void openWorkspaceAt(p) })),
              { label: 'Open or clone another…', icon: ArrowLeftRight, onSelect: () => void closeWorkspace() },
            ],
          })
        }
      >
        <FolderOpen size={16} />
        <span className="mobile-notes-workspace-name">{name}</span>
        <ChevronDown size={16} />
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
              { label: 'Delete local copy…', icon: Trash2, onSelect: () => void deleteLocalCopy(), destructive: true },
            ],
          })
        }
      >
        <Ellipsis size={20} />
      </button>
    </div>
  )
}
