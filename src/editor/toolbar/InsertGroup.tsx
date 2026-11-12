import { PenLine, Sigma, Table, Code, Info, Shapes, Plus, ChevronDown } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { insertInk } from './insertInk'
import { report } from '../splitIntoTasks'
import { SymbolPaletteButton } from './SymbolPaletteButton'

interface InsertGroupProps {
  editor: Editor
  notePath: string
}

export function InsertGroup({ editor, notePath }: InsertGroupProps) {
  return (
    <div className="toolbar-group" role="group" aria-label="Insert">
      <button className="toolbar-button" aria-label="Insert ink canvas" title="Insert ink canvas"
        onClick={() => void insertInk(editor, notePath).catch(report)}>
        <PenLine size={15} />
      </button>
      <button className="toolbar-button" aria-label="Insert equation" title="Insert equation"
        onClick={() => editor.chain().focus().insertContent({ type: 'blockMath', attrs: { latex: '' } }).run()}>
        <Sigma size={15} />
      </button>
      <SymbolPaletteButton editor={editor} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="toolbar-button toolbar-button-labeled" aria-label="Insert block" title="Insert a diagram, table, code block or callout">
            <Plus size={15} />
            <span>Insert</span>
            <ChevronDown size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="context-menu"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            editor.commands.focus()
          }}
        >
          <DropdownMenuItem onSelect={() => editor.storage.noteContext.openDiagramDialog?.(editor, null)}>
            <Shapes size={14} /> Diagram
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
            <Table size={14} /> Table
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editor.chain().focus().setCodeBlock().run()}>
            <Code size={14} /> Code block
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => editor.chain().focus()
              .insertContent({ type: 'callout', attrs: { calloutType: 'note', title: '' }, content: [{ type: 'paragraph' }] })
              .run()}
          >
            <Info size={14} /> Callout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
