import type { ReactNode } from 'react'
import {
  Baseline, Bold, Code, Heading1, Heading2, Heading3, Highlighter, IndentDecrease, IndentIncrease,
  Info, Italic, List, ListOrdered, PenLine, Redo2, Shapes, Sigma, Table, Undo2, Omega,
  type LucideIcon,
} from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { ColorMenu } from './ColorMenu'
import { SymbolPaletteButton } from './SymbolPaletteButton'
import { insertInk } from './insertInk'
import { report } from '../splitIntoTasks'
import { handleEditorKeyDown } from '../extensions/CodeBlockEditor'

interface ToolbarContext {
  editor: Editor
  notePath: string
}

interface ToolbarItemBase {
  id: string
  label: string
  icon: LucideIcon
}

interface ToolbarCommand extends ToolbarItemBase {
  run: (ctx: ToolbarContext) => void
  isActive?: (editor: Editor) => boolean
  isDisabled?: (editor: Editor) => boolean
}

// Items that open their own popover rather than run once.
interface ToolbarWidget extends ToolbarItemBase {
  widget: (editor: Editor) => ReactNode
}

export type ToolbarItem = ToolbarCommand | ToolbarWidget

export function isWidget(item: ToolbarItem): item is ToolbarWidget {
  return 'widget' in item
}

// Tab and Shift+Tab already do the right thing in lists, code blocks and
// plain paragraphs; replaying the key keeps the button and the keyboard one path.
function pressTab(editor: Editor, shiftKey: boolean) {
  editor.commands.focus()
  handleEditorKeyDown(editor.view, new KeyboardEvent('keydown', { key: 'Tab', shiftKey }))
}

function heading(level: 1 | 2 | 3, icon: LucideIcon): ToolbarCommand {
  return {
    id: `heading-${level}`,
    label: `Heading ${level}`,
    icon,
    run: ({ editor }) => editor.chain().focus().toggleHeading({ level }).run(),
    isActive: (editor) => editor.isActive('heading', { level }),
  }
}

function insertBlock(id: string, label: string, icon: LucideIcon, run: (editor: Editor) => void): ToolbarCommand {
  return { id, label, icon, run: ({ editor }) => run(editor) }
}

// The one list of what a mobile toolbar can hold. Order here is the default
// order; Settings re-orders and hides from it, and any other mobile surface
// that wants an editing action can read it too.
export const TOOLBAR_ITEMS: ToolbarItem[] = [
  {
    id: 'undo', label: 'Undo', icon: Undo2,
    run: ({ editor }) => editor.chain().focus().undo().run(),
    isDisabled: (editor) => !editor.can().undo(),
  },
  {
    id: 'redo', label: 'Redo', icon: Redo2,
    run: ({ editor }) => editor.chain().focus().redo().run(),
    isDisabled: (editor) => !editor.can().redo(),
  },
  {
    id: 'bold', label: 'Bold', icon: Bold,
    run: ({ editor }) => editor.chain().focus().toggleBold().run(),
    isActive: (editor) => editor.isActive('bold'),
  },
  {
    id: 'italic', label: 'Italic', icon: Italic,
    run: ({ editor }) => editor.chain().focus().toggleItalic().run(),
    isActive: (editor) => editor.isActive('italic'),
  },
  {
    id: 'text-color', label: 'Text color', icon: Baseline,
    widget: (editor) => (
      <ColorMenu
        label="Text color"
        icon={<Baseline size={15} />}
        toValue={(hue) => hue}
        current={(editor.getAttributes('spanStyle')['color'] as string | null | undefined) ?? null}
        onPick={(color) => editor.chain().focus().setSpanColor(color).run()}
      />
    ),
  },
  {
    id: 'highlight', label: 'Highlight color', icon: Highlighter,
    widget: (editor) => (
      <ColorMenu
        label="Highlight color"
        icon={<Highlighter size={15} />}
        toValue={(hue) => `${hue}59`}
        current={(editor.getAttributes('spanStyle')['backgroundColor'] as string | null | undefined) ?? null}
        onPick={(background) => editor.chain().focus().setSpanBackground(background).run()}
      />
    ),
  },
  heading(1, Heading1),
  heading(2, Heading2),
  heading(3, Heading3),
  {
    id: 'bullet-list', label: 'Bullet list', icon: List,
    run: ({ editor }) => editor.chain().focus().toggleBulletList().run(),
    isActive: (editor) => editor.isActive('bulletList'),
  },
  {
    id: 'numbered-list', label: 'Numbered list', icon: ListOrdered,
    run: ({ editor }) => editor.chain().focus().toggleOrderedList().run(),
    isActive: (editor) => editor.isActive('orderedList'),
  },
  { id: 'outdent', label: 'Outdent', icon: IndentDecrease, run: ({ editor }) => pressTab(editor, true) },
  { id: 'indent', label: 'Indent', icon: IndentIncrease, run: ({ editor }) => pressTab(editor, false) },
  {
    id: 'ink', label: 'Insert ink canvas', icon: PenLine,
    run: ({ editor, notePath }) => void insertInk(editor, notePath).catch(report),
  },
  insertBlock('equation', 'Insert equation', Sigma, (editor) =>
    editor.chain().focus().insertContent({ type: 'blockMath', attrs: { latex: '' } }).run()),
  { id: 'symbols', label: 'Symbol palette', icon: Omega, widget: (editor) => <SymbolPaletteButton editor={editor} /> },
  insertBlock('table', 'Insert table', Table, (editor) =>
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
  insertBlock('code-block', 'Insert code block', Code, (editor) => editor.chain().focus().setCodeBlock().run()),
  insertBlock('callout', 'Insert callout', Info, (editor) =>
    editor.chain().focus()
      .insertContent({ type: 'callout', attrs: { calloutType: 'note', title: '' }, content: [{ type: 'paragraph' }] })
      .run()),
  insertBlock('diagram', 'Insert diagram', Shapes, (editor) =>
    editor.storage.noteContext.openDiagramDialog?.(editor, null)),
]

export const DEFAULT_TOOLBAR_ITEMS: string[] = TOOLBAR_ITEMS.map((item) => item.id)

const BY_ID = new Map(TOOLBAR_ITEMS.map((item) => [item.id, item]))

/** The saved ids resolved to items (`null` is the default list); an id from a build that no longer has it is dropped. */
export function resolveToolbarItems(saved: string[] | null): ToolbarItem[] {
  return (saved ?? DEFAULT_TOOLBAR_ITEMS).flatMap((id) => BY_ID.get(id) ?? [])
}

/** Every item the saved list leaves out, in registry order — what Settings offers to add back. */
export function hiddenToolbarItems(saved: string[] | null): ToolbarItem[] {
  const shown = new Set(resolveToolbarItems(saved).map((item) => item.id))
  return TOOLBAR_ITEMS.filter((item) => !shown.has(item.id))
}
