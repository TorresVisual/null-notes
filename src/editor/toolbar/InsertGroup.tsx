import { PenLine, Sigma, Table, Code, Info } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { inkApi } from '../../lib/ink'
import type { InkData } from '../../ink/types'

interface InsertGroupProps {
  editor: Editor
  notePath: string
}

const INK_WIDTH = 700
const INK_HEIGHT = 900
const EMPTY_INK: InkData = { width: INK_WIDTH, height: INK_HEIGHT, strokes: [], shapes: [] }

export function InsertGroup({ editor, notePath }: InsertGroupProps) {
  async function insertInk() {
    const dir = await inkApi.ensureDir(notePath)
    const sep = dir.includes('\\') ? '\\' : '/'
    const svgPath = `${dir}${sep}sketch-${Date.now()}.svg`
    await inkApi.write(svgPath, EMPTY_INK)
    editor.commands.insertContent({
      type: 'inkBlock',
      attrs: { src: svgPath, width: INK_WIDTH, height: INK_HEIGHT },
    })
  }

  return (
    <div className="toolbar-group" role="group" aria-label="Insert">
      <button className="toolbar-button" aria-label="Insert ink canvas" title="Insert ink canvas"
        onClick={() => void insertInk()}>
        <PenLine size={15} />
      </button>
      <button className="toolbar-button" aria-label="Insert equation" title="Insert equation"
        onClick={() => editor.chain().focus().insertContent({ type: 'blockMath', attrs: { latex: '' } }).run()}>
        <Sigma size={15} />
      </button>
      <button className="toolbar-button" aria-label="Insert table" title="Insert table"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <Table size={15} />
      </button>
      <button className="toolbar-button" aria-label="Insert code block" title="Insert code block"
        onClick={() => editor.chain().focus().setCodeBlock().run()}>
        <Code size={15} />
      </button>
      <button className="toolbar-button" aria-label="Insert callout" title="Insert callout"
        onClick={() => editor.chain().focus()
          .insertContent({ type: 'callout', attrs: { calloutType: 'note', title: '' }, content: [{ type: 'paragraph' }] })
          .run()}>
        <Info size={15} />
      </button>
    </div>
  )
}
