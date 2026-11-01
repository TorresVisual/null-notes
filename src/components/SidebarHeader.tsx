import { ChevronsUpDown, FilePlus, FileUp, FolderOpen, FolderPlus, LayoutTemplate, PenLine, Plus, Search } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { isWeb } from '../lib/platform'
import { useWorkspace } from '../hooks/useWorkspace'
import { useCreateNote } from '../hooks/useCreateNote'
import { useCreateFolder } from '../hooks/useCreateFolder'
import { useCreateCanvasNote } from '../hooks/useCreateCanvasNote'
import { useImportPdf } from './ImportButton'
import { folderName } from '../lib/pathPrefix'
import { promptText } from '../store/promptDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

interface SidebarHeaderProps {
  onSearchOpen: () => void
  onTemplateOpen: () => void
}

export function SidebarHeader({ onSearchOpen, onTemplateOpen }: SidebarHeaderProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const folderLoading = useWorkspaceStore((s) => s.folderLoading)
  const recentWorkspaces = useWorkspaceStore((s) => s.recentWorkspaces)
  const { openWorkspace, openWorkspaceAt } = useWorkspace()
  const createNote = useCreateNote()
  const createFolder = useCreateFolder()
  const createCanvasNote = useCreateCanvasNote()
  const importPdf = useImportPdf()

  const others = recentWorkspaces.filter((p) => p !== workspacePath)
  const workspaceLabel = folderLoading ? 'Opening…' : workspacePath ? folderName(workspacePath) : 'Open Workspace'

  async function handleCreateNote() {
    const title = await promptText('Note title:')
    if (title) await createNote(title)
  }

  async function handleCreateCanvasNote() {
    const title = await promptText('Canvas note title:')
    if (title) await createCanvasNote(title)
  }

  async function handleCreateFolder() {
    const name = await promptText('Folder name:')
    if (name) await createFolder(name)
  }

  return (
    <div className="sidebar-header">
      <div className="sidebar-header-row">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="sidebar-workspace" disabled={folderLoading} title={workspacePath ?? undefined}>
              <FolderOpen size={14} />
              <span className="sidebar-workspace-name">{workspaceLabel}</span>
              <ChevronsUpDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="context-menu">
            {others.length > 0 && (
              <>
                <DropdownMenuLabel>Recent</DropdownMenuLabel>
                {others.map((p) => (
                  <DropdownMenuItem key={p} title={p} onSelect={() => void openWorkspaceAt(p)}>
                    {folderName(p)}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={() => void openWorkspace()}>
              <FolderOpen size={14} /> Open workspace…
              <DropdownMenuShortcut>Ctrl O</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="sidebar-new" aria-label="New" disabled={!workspacePath}>
              <Plus size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="context-menu">
            <DropdownMenuItem onSelect={() => void handleCreateNote()}>
              <FilePlus size={14} /> Note
              <DropdownMenuShortcut>Ctrl N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleCreateFolder()}>
              <FolderPlus size={14} /> Folder
              <DropdownMenuShortcut>Ctrl Shift N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleCreateCanvasNote()}>
              <PenLine size={14} /> Canvas
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onTemplateOpen}>
              <LayoutTemplate size={14} /> From template…
              <DropdownMenuShortcut>Ctrl Shift T</DropdownMenuShortcut>
            </DropdownMenuItem>
            {!isWeb() && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={importPdf.disabled} onSelect={() => importPdf.start()}>
                  <FileUp size={14} /> Import PDF…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <button className="sidebar-search" onClick={onSearchOpen} disabled={!workspacePath}>
        <Search size={14} />
        <span>Search notes</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="import-pdf">{importPdf.status}</div>
    </div>
  )
}
