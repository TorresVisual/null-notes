import StarterKit from '@tiptap/starter-kit'
import { Code } from '@tiptap/extension-code'
import { markInputRule, Extension, InputRule } from '@tiptap/core'
import type { ResolvedPos } from '@tiptap/pm/model'
import { Markdown } from 'tiptap-markdown'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Link } from '@tiptap/extension-link'
import { createLowlight, common } from 'lowlight'
import { InkBlock } from './InkBlock'
import { ExerciseBlock } from './ExerciseBlock'
import { InlineMath } from './InlineMath'
import { BlockMath } from './BlockMath'
import { MermaidBlock } from './MermaidBlock'
import { Callout } from './Callout'
import { WikiLink } from './WikiLink'
import { Tag } from './Tag'
import { NoteContext } from './NoteContext'
import { SlashCommands } from './SlashCommands'

const lowlight = createLowlight(common)

// TipTap 3's Code mark uses a function-based find for its input rule.
// Negative lookbehind regex matches markInputRule's expectation: last capture
// group is the content, full match covers only the delimiters + content.
const CodeWithRegexpRule = Code.extend({
  addInputRules() {
    return [
      markInputRule({
        find: /(?<!`)`([^`\s](?:[^`]*[^`\s])?)`$/,
        type: this.type,
      }),
    ]
  },
})

// Files saved before TaskList was added have \[x\] and \[ \] because
// prosemirror-markdown escaped bare brackets to prevent link mis-parsing.
// Preprocess the raw source before markdown-it touches it so those become
// proper task-list checkboxes on the next save.
const TaskBracketFix = Extension.create({
  name: 'taskBracketFix',
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(md: Record<string, unknown>) {
            const orig = md['parse'] as (src: string, env: unknown) => unknown[]
            md['parse'] = (src: string, env: unknown) => {
              const fixed = src.replace(/^([ \t]*[-*+] +)\\\[([x ])\\\]/gm, '$1[$2]')
              return orig.call(md, fixed, env)
            }
          },
        },
      },
    }
  },
})

function isInsideListItem($from: ResolvedPos): boolean {
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'listItem') return true
  }
  return false
}

// TipTap's stock "[ ] " rule wraps the paragraph in a taskItem, which the
// schema forbids inside a bulletList — so typing "- [ ] " found no valid
// wrapping, silently did nothing, and left literal brackets the serializer
// then escaped to "\[ \]". Inside a list, convert the list instead.
const TaskItemInLists = TaskItem.extend({
  addInputRules() {
    return [
      ...(this.parent?.() ?? []),
      new InputRule({
        find: /^\s*\[([ x])\]\s$/,
        handler: ({ state, range, match, chain }) => {
          if (!isInsideListItem(state.selection.$from)) return null
          const checked = match[1] === 'x'
          chain()
            .deleteRange(range)
            .toggleTaskList()
            .updateAttributes('taskItem', { checked })
            .run()
          return
        },
      }),
    ]
  },
})

export const coreExtensions = [
  StarterKit.configure({ code: false, codeBlock: false }),
  CodeWithRegexpRule,
  CodeBlockLowlight.configure({ lowlight }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItemInLists.configure({ nested: true }),
  Link.configure({ openOnClick: false, autolink: true }),
  Markdown.configure({
    html: false,
    transformPastedText: true,
    transformCopiedText: true,
  }),
  Placeholder.configure({ placeholder: 'Start writing…' }),
  TaskBracketFix,
  InkBlock,
  ExerciseBlock,
  InlineMath,
  BlockMath,
  MermaidBlock,
  Callout,
  WikiLink,
  Tag,
  NoteContext,
  SlashCommands,
]
