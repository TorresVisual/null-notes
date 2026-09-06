import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Copy, Minus, Square, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { folderName } from '../lib/pathPrefix'

interface MenuEntry {
  id: string
  label: string
  accel?: string
}
type MenuItemSpec = MenuEntry | { separator: true }

// Mirrors the native menu structure the Rust side used to build (build_menu,
// src-tauri/src/lib.rs, removed when decorations went custom) — same ids, so
// Layout.tsx's runCommand needs no changes. Edit (clipboard) and Quit were
// dropped: clipboard shortcuts work natively without a menu entry, and Quit
// is now just the close button, routed through the same flush-before-close
// path instead of bypassing it.
function buildFileMenu(recentWorkspaces: string[]): MenuItemSpec[] {
  return [
    { id: 'new-note', label: 'New Note', accel: 'Ctrl+N' },
    { id: 'new-folder', label: 'New Folder', accel: 'Ctrl+Shift+N' },
    { id: 'new-canvas', label: 'New Canvas Note' },
    { id: 'new-from-template', label: 'New from Template…', accel: 'Ctrl+Shift+T' },
    { separator: true },
    { id: 'open-workspace', label: 'Open Workspace…', accel: 'Ctrl+O' },
    { id: 'close-workspace', label: 'Close Workspace' },
    ...recentWorkspaces.map((path) => ({ id: `open-recent:${path}`, label: folderName(path) })),
    { separator: true },
    { id: 'split-tasks', label: 'Split Into Tasks' },
    { id: 'generate-formula-sheet', label: 'Generate Formula Sheet…' },
    { separator: true },
    { id: 'export-pdf', label: 'Export to PDF…' },
    { id: 'print', label: 'Print…' },
    { separator: true },
    { id: 'settings', label: 'Settings…', accel: 'Ctrl+,' },
  ]
}

const VIEW_MENU: MenuItemSpec[] = [
  { id: 'home', label: 'Home', accel: 'Ctrl+H' },
  { separator: true },
  { id: 'search', label: 'Search', accel: 'Ctrl+K' },
  { id: 'quick-switch', label: 'Quick Switcher', accel: 'Ctrl+P' },
  { id: 'toggle-view', label: 'Toggle Source/Preview', accel: 'Ctrl+E' },
  { id: 'insert-ink', label: 'Insert Ink Block', accel: 'Ctrl+Shift+I' },
  { id: 'graph-view', label: 'Connections Graph', accel: 'Ctrl+G' },
  { id: 'toggle-terminal', label: 'Toggle Terminal', accel: 'Ctrl+`' },
  { id: 'toggle-outline', label: 'Toggle Outline', accel: 'Ctrl+Shift+O' },
  { id: 'task-view', label: 'Tasks', accel: 'Ctrl+Shift+K' },
  { id: 'review', label: 'Review', accel: 'Ctrl+Shift+R' },
  { id: 'deck-view', label: 'Browse All Cards', accel: 'Ctrl+Shift+D' },
  { separator: true },
  { id: 'shortcuts-help', label: 'Keyboard Shortcuts' },
]

interface TitlebarProps {
  title: string
  onCommand: (id: string) => void
  recentWorkspaces?: string[]
}

export function Titlebar({ title, onCommand, recentWorkspaces = [] }: TitlebarProps) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const win = getCurrentWindow()
    void win.isMaximized().then(setMaximized)
    const unlisten = win.onResized(() => void win.isMaximized().then(setMaximized))
    return () => void unlisten.then((off) => off())
  }, [])

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-menus">
        <TitlebarMenu label="File" items={buildFileMenu(recentWorkspaces)} onCommand={onCommand} />
        <TitlebarMenu label="View" items={VIEW_MENU} onCommand={onCommand} />
      </div>
      <div
        className="titlebar-title"
        data-tauri-drag-region
        onDoubleClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {title}
      </div>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn"
          aria-label="Minimize"
          onClick={() => void getCurrentWindow().minimize()}
        >
          <Minus size={14} />
        </button>
        <button
          className="titlebar-btn"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => void getCurrentWindow().toggleMaximize()}
        >
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          aria-label="Close"
          onClick={() => void getCurrentWindow().close()}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

interface TitlebarMenuProps {
  label: string
  items: MenuItemSpec[]
  onCommand: (id: string) => void
}

function TitlebarMenu({ label, items, onCommand }: TitlebarMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="titlebar-menu-trigger">{label}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="context-menu">
        {items.map((item, i) =>
          'separator' in item ? (
            <DropdownMenuSeparator key={i} />
          ) : (
            <DropdownMenuItem key={item.id} onSelect={() => onCommand(item.id)}>
              {item.label}
              {item.accel && <DropdownMenuShortcut>{item.accel}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
