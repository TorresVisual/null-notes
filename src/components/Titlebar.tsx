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
import { commandById, formatCombo } from '../lib/keymap'
import { useKeymap } from '../hooks/useKeymap'

export interface MenuEntry {
  id: string
  label: string
}
export type MenuItemSpec = MenuEntry | { separator: true }

const SEPARATOR = { separator: true } as const

function entries(ids: string[]): MenuItemSpec[] {
  return ids.map((id) => (id === '-' ? SEPARATOR : commandEntry(id)))
}

function commandEntry(id: string): MenuEntry {
  const command = commandById(id)
  return { id, label: command?.label ?? id }
}

// Mirrors the native menu structure the Rust side used to build (build_menu,
// src-tauri/src/lib.rs, removed when decorations went custom) — same ids, so
// Layout.tsx's runCommand needs no changes. Edit (clipboard) was dropped:
// clipboard shortcuts work natively without a menu entry. Exit routes
// through the same window.close() the titlebar's close button uses, so it
// still hits the flush-before-close path rather than bypassing it. Labels and
// accelerators come from the keymap registry, not from here.
export function buildFileMenu(recentWorkspaces: string[]): MenuItemSpec[] {
  return [
    ...entries(['new-note', 'new-folder', 'new-canvas', 'new-from-template', '-', 'open-workspace', 'close-workspace']),
    ...recentWorkspaces.map((path) => ({ id: `open-recent:${path}`, label: folderName(path) })),
    ...entries([
      '-',
      'split-tasks',
      'generate-formula-sheet',
      '-',
      'export-pdf',
      'print',
      '-',
      'trash',
      'settings',
      '-',
      'exit',
    ]),
  ]
}

export const VIEW_MENU: MenuItemSpec[] = entries([
  'home',
  '-',
  'search',
  'quick-switch',
  'command-palette',
  'toggle-view',
  'insert-ink',
  'graph-view',
  'toggle-terminal',
  'toggle-outline',
  'toggle-outgoing-links',
  'fold-all',
  'unfold-all',
  'toggle-sidebar',
  'task-view',
  'review',
  'deck-view',
  '-',
  'shortcuts-help',
])

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
  const keymap = useKeymap()
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
              {keymap[item.id] && <DropdownMenuShortcut>{formatCombo(keymap[item.id])}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
