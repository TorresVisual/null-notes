import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { createPortal } from 'react-dom'
import { inkApi } from '../../lib/ink'
import { nextTaskLabel } from '../../lib/taskScaffold'
import { splitIntoTasks, addNextTask, report } from '../splitIntoTasks'
import type { InkData } from '../../ink/types'

const INK_WIDTH = 700
const INK_HEIGHT = 900

const EMPTY_INK: InkData = { width: INK_WIDTH, height: INK_HEIGHT, strokes: [], shapes: [] }

interface Cmd {
  title: string
  description: string
  run: (params: { editor: Editor; range: Range }) => void
}

function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  return storage.markdown.getMarkdown()
}

const COMMANDS: Cmd[] = [
  {
    title: 'Heading 1',
    description: 'Large section heading',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    title: 'Code Block',
    description: 'Syntax-highlighted code',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    title: 'Mermaid Diagram',
    description: 'Flowchart, sequence, or Gantt diagram',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mermaidBlock', attrs: { code: 'graph LR\n    A --> B' } })
        .run(),
  },
  {
    title: 'Note',
    description: 'Info callout',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'callout', attrs: { calloutType: 'note', title: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    title: 'Warning',
    description: 'Warning callout',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'callout', attrs: { calloutType: 'warning', title: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    title: 'Tip',
    description: 'Tip callout',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'callout', attrs: { calloutType: 'tip', title: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    title: 'Danger',
    description: 'Danger callout',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'callout', attrs: { calloutType: 'danger', title: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    title: 'Task List',
    description: 'Checkable to-do list',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Divider',
    description: 'Horizontal rule',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: 'Ink Block',
    description: 'Handwriting canvas',
    run: ({ editor, range }) => {
      const notePath = editor.storage.noteContext.notePath
      if (!notePath) return
      editor.chain().focus().deleteRange(range).run()
      void inkApi.ensureDir(notePath).then((dir) => {
        const sep = dir.includes('\\') ? '\\' : '/'
        const svgPath = `${dir}${sep}sketch-${Date.now()}.svg`
        return inkApi.write(svgPath, EMPTY_INK).then(() => {
          editor.commands.insertContent({ type: 'inkBlock', attrs: { src: svgPath, width: INK_WIDTH, height: INK_HEIGHT } })
        })
      })
    },
  },
  {
    title: 'Inline Equation',
    description: 'LaTeX inside a line of text',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'inlineMath', attrs: { latex: '' } })
        .run(),
  },
  {
    title: 'Block Math',
    description: 'LaTeX block equation',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'blockMath', attrs: { latex: '' } }).run(),
  },
  {
    title: 'Split Into Tasks',
    description: 'Rewrite this note as Task / Solution sections with a canvas each',
    // Never happens on its own. A PDF import produces a plain note, because
    // "this document is an exercise sheet" is a claim about the document that
    // only the reader can make — a lecture script is not one.
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      void splitIntoTasks(editor)
        .then((outcome) => {
          if (outcome === 'no-structure') {
            alert('No exercise structure found in this note — nothing was changed.')
          }
        })
        .catch(report)
    },
  },
  {
    title: 'Add Next Task',
    description: 'Append the next numbered Task and Solution pair, ready to write in',
    // Appended at the end of the note rather than at the cursor: the point is
    // that room for one more exercise is never something to plan in advance,
    // and the next task belongs after the last one wherever you happen to be.
    // Built as nodes rather than Markdown so the heading text is exactly what
    // `nextTaskLabel` will read back on the following invocation.
    run: ({ editor, range }) => {
      const label = nextTaskLabel(getMarkdown(editor))
      editor.chain().focus().deleteRange(range).run()
      void addNextTask(editor, label).catch(report)
    },
  },
  {
    title: 'Table',
    description: '3×3 table with header row',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: 'Info',
    description: 'Info callout',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'callout', attrs: { calloutType: 'info', title: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    title: 'Important',
    description: 'Important callout',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'callout', attrs: { calloutType: 'important', title: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
]

// ── Menu component ────────────────────────────────────────────────────────────

interface MenuProps {
  items: Cmd[]
  onSelect: (cmd: Cmd) => void
  clientRect: (() => DOMRect | null) | null
}

interface MenuHandle {
  onKeyDown: (e: KeyboardEvent) => boolean
}

const SlashMenu = forwardRef<MenuHandle, MenuProps>(function SlashMenu(
  { items, onSelect, clientRect },
  ref,
) {
  const [selected, setSelected] = useState(0)

  useEffect(() => setSelected(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown(e) {
      if (e.key === 'ArrowUp') {
        setSelected((s) => Math.max(0, s - 1))
        return true
      }
      if (e.key === 'ArrowDown') {
        setSelected((s) => Math.min(items.length - 1, s + 1))
        return true
      }
      if (e.key === 'Enter') {
        const item = items[selected]
        if (item) onSelect(item)
        return true
      }
      return false
    },
  }))

  const rect = clientRect?.()
  if (!items.length || !rect) return null

  return createPortal(
    <div
      className="slash-menu"
      style={{ position: 'fixed', top: rect.bottom + 6, left: rect.left, zIndex: 50 }}
    >
      {items.map((item, i) => (
        <button
          key={item.title}
          className={`slash-menu-item${i === selected ? ' selected' : ''}`}
          onMouseEnter={() => setSelected(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(item)
          }}
        >
          <span className="slash-item-title">{item.title}</span>
          <span className="slash-item-desc">{item.description}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
})

// ── Extension ─────────────────────────────────────────────────────────────────

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items({ query }: { query: string }) {
          const q = query.toLowerCase()
          return q
            ? COMMANDS.filter(
                (c) => c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
              )
            : COMMANDS
        },
        command({ editor, range, props }) {
          ;(props as Cmd).run({ editor, range })
        },
        render() {
          let renderer: ReactRenderer<MenuHandle, MenuProps>

          return {
            onStart(props) {
              renderer = new ReactRenderer(SlashMenu, {
                props: {
                  items: props.items as Cmd[],
                  onSelect: (cmd: Cmd) => props.command(cmd),
                  clientRect: props.clientRect,
                },
                editor: props.editor,
              })
            },
            onUpdate(props) {
              renderer.updateProps({
                items: props.items as Cmd[],
                onSelect: (cmd: Cmd) => props.command(cmd),
                clientRect: props.clientRect,
              })
            },
            onKeyDown({ event }) {
              if (event.key === 'Escape') {
                renderer.destroy()
                return true
              }
              return renderer.ref?.onKeyDown(event) ?? false
            },
            onExit() {
              renderer.destroy()
            },
          }
        },
      }),
    ]
  },
})
