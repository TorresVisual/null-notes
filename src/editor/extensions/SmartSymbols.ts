import { Extension, InputRule } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'

// `!=`, `<=`, `>=` are meaningful as literal ASCII inside code and are how
// this app's own LaTeX pipeline reads relations — converting them there
// would corrupt working code or a hand-typed equation, so the rule only
// fires in ordinary prose.
function inProseContext(state: EditorState): boolean {
  const { $from } = state.selection
  if ($from.parent.type.name === 'codeBlock') return false
  return !$from.marks().some((mark) => mark.type.name === 'code')
}

const REPLACEMENTS: Array<{ find: RegExp; replacement: string }> = [
  { find: /!=$/, replacement: '≠' },
  { find: /<=$/, replacement: '≤' },
  { find: />=$/, replacement: '≥' },
]

export const SmartSymbols = Extension.create({
  name: 'smartSymbols',

  addInputRules() {
    return REPLACEMENTS.map(
      ({ find, replacement }) =>
        new InputRule({
          find,
          handler: ({ state, range, chain }) => {
            if (!inProseContext(state)) return
            chain().deleteRange(range).insertContent(replacement).run()
          },
        }),
    )
  },
})
