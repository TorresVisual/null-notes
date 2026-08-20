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
import { Link } from '@tiptap/extension-link'
import { createLowlight, common } from 'lowlight'
import { InkBlock } from './InkBlock'
import { NoteImage } from './NoteImage'
import { PdfPageBlock } from './PdfPageBlock'
import { InlineMath } from './InlineMath'
import { BlockMath } from './BlockMath'
import { MermaidBlock } from './MermaidBlock'
import { Callout } from './Callout'
import { WikiLink } from './WikiLink'
import { CodeLink } from './CodeLink'
import { CodeBlockOpenInIde } from './CodeBlockOpenInIde'
import { CrossRef } from './CrossRef'
import { Tag } from './Tag'
import { NoteContext } from './NoteContext'
import { SlashCommands } from './SlashCommands'
import { CodeBlockEditor } from './CodeBlockEditor'
import { Underline } from './Underline'
import { Subscript } from './Subscript'
import { Superscript } from './Superscript'
import { Highlight } from './Highlight'
import { Kbd } from './Kbd'
import { SpanStyle } from './SpanStyle'
import { HTMLInline } from './HTMLInline'
import { HTMLBlock } from './HTMLBlock'
import { SrState } from './SrState'
import { DivBlock } from './DivBlock'
import { Details } from './Details'
import { TextAlignment } from './TextAlignment'
import { Divider } from './Divider'
import { NodeRange } from '@tiptap/extension-node-range'

const lowlight = createLowlight(common)

// TipTap 3's Code mark uses a function-based find for its input rule.
// Negative lookbehind regex matches markInputRule's expectation: last capture
// group is the content, full match covers only the delimiters + content.
// The spellcheck attribute is inherited by descendants, so marking the
// non-prose nodes false carves them out of the editor-wide setting: prose gets
// checked, code, maths, diagrams, tags and link targets don't. Without this a
// spellchecked note is a wall of red under every identifier and \alpha.
const NO_SPELLCHECK = { spellcheck: 'false' }

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
  // StarterKit 3 bundles its own Link and Underline; leaving them on registers
  // the name twice and the app's own config is the one that loses.
  StarterKit.configure({
    code: false,
    codeBlock: false,
    link: false,
    underline: false,
    horizontalRule: false,
    dropcursor: { color: 'var(--accent)', width: 2 },
  }),
  Divider,
  NodeRange.configure({ key: 'Shift' }),
  CodeWithRegexpRule.configure({ HTMLAttributes: NO_SPELLCHECK }),
  CodeBlockEditor.configure({ lowlight, HTMLAttributes: NO_SPELLCHECK }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItemInLists.configure({ nested: true }),
  Link.configure({ openOnClick: false, autolink: true }),
  Markdown.configure({
    html: true,
    transformPastedText: true,
    transformCopiedText: true,
  }),
  Placeholder.configure({ placeholder: 'Start writing…' }),
  TaskBracketFix,
  InkBlock,
  NoteImage,
  PdfPageBlock,
  InlineMath,
  BlockMath,
  MermaidBlock,
  Callout,
  WikiLink,
  Tag,
  CodeLink,
  CodeBlockOpenInIde,
  CrossRef,
  NoteContext,
  SlashCommands,
  // Typography marks
  Underline,
  Subscript,
  Superscript,
  Highlight,
  Kbd,
  SpanStyle,
  // Generic HTML containers (must come after specific custom nodes so priority
  // order allows Callout / Details / InlineMath to claim their tags first)
  Details,
  DivBlock,
  HTMLBlock,
  HTMLInline,
  SrState,
  TextAlignment,
]
