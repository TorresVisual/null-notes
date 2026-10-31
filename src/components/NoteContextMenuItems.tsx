import { Copy, ExternalLink, FolderInput, Merge, FolderOpen, Link, Pencil, Trash2 } from 'lucide-react'
import {
  copyNotePath,
  deleteNote,
  duplicateNote,
  moveNoteViaPicker,
  openNoteExternally,
  renameNote,
  revealNote,
} from '../lib/noteActions'
import { BookmarkMenuItem } from './BookmarkMenuItem'
import { ContextMenuItem, ContextMenuSeparator } from './ui/context-menu'

interface NoteContextMenuItemsProps {
  path: string
}

export function NoteContextMenuItems({ path }: NoteContextMenuItemsProps) {
  return (
    <>
      <BookmarkMenuItem bookmark={{ kind: 'note', path }} />
      <ContextMenuItem onSelect={() => void duplicateNote(path)}>
        <Copy size={14} /> Duplicate
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void moveNoteViaPicker(path)}>
        <FolderInput size={14} /> Move to…
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => window.dispatchEvent(new CustomEvent('note:merge-request', { detail: path }))}>
        <Merge size={14} /> Merge into…
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => void revealNote(path)}>
        <FolderOpen size={14} /> Show in File Explorer
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void openNoteExternally(path)}>
        <ExternalLink size={14} /> Open in default app
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void copyNotePath(path, 'absolute')}>
        <Link size={14} /> Copy path
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void copyNotePath(path, 'relative')}>
        <Link size={14} /> Copy relative path
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => void renameNote(path)}>
        <Pencil size={14} /> Rename
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onSelect={() => void deleteNote(path)}>
        <Trash2 size={14} /> Delete
      </ContextMenuItem>
    </>
  )
}
