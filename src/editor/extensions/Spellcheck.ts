import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { misspelledWords } from '../../lib/spellClient'
import { spellTokens, type SpellLanguage } from '../../lib/spellTokens'

export interface SpellRange {
  from: number
  to: number
  word: string
}

export interface SpellMenuTarget extends SpellRange {
  x: number
  y: number
  lang: SpellLanguage
}

export interface SpellcheckStorage {
  enabled: boolean
  lang: SpellLanguage
  personal: Set<string>
  recheck: () => void
  onMenu: ((target: SpellMenuTarget) => void) | null
}

declare module '@tiptap/core' {
  interface Storage {
    spellcheck: SpellcheckStorage
  }
}

const key = new PluginKey<SpellRange[]>('spellcheck')
const RECHECK_DELAY_MS = 400

// Nodes and marks that hold code, markup or notation rather than prose.
const NON_PROSE_NODES = new Set(['codeBlock', 'htmlBlock', 'htmlInline', 'htmlComment', 'blockMath', 'inlineMath'])
const NON_PROSE_MARKS = new Set(['code', 'kbd'])
// Stands in for anything that is not checkable text, same width as what it
// replaces so string offsets stay equal to document offsets.
const GAP = '￼'

export function collectSpellRanges(doc: PMNode): SpellRange[] {
  const ranges: SpellRange[] = []
  doc.descendants((node, pos) => {
    if (NON_PROSE_NODES.has(node.type.name)) return false
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => {
      const checked = child.isText && !child.marks.some((mark) => NON_PROSE_MARKS.has(mark.type.name))
      text += checked ? (child.text ?? '') : GAP.repeat(child.nodeSize)
    })
    for (const token of spellTokens(text)) {
      ranges.push({ from: pos + 1 + token.start, to: pos + 1 + token.end, word: token.word })
    }
    return false
  })
  return ranges
}

// Native spellcheck depends on whichever language packs the OS has; this asks
// the bundled Hunspell dictionaries in the backend instead, so the answer is
// the same on every machine.
export const Spellcheck = Extension.create<object, SpellcheckStorage>({
  name: 'spellcheck',

  addStorage() {
    return { enabled: false, lang: 'en', personal: new Set<string>(), recheck: () => {}, onMenu: null }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin<SpellRange[]>({
        key,
        state: {
          init: () => [],
          apply(tr, ranges) {
            const fresh = tr.getMeta(key) as SpellRange[] | undefined
            if (fresh) return fresh
            if (!tr.docChanged) return ranges
            return ranges.flatMap((range) => {
              const from = tr.mapping.map(range.from, 1)
              const to = tr.mapping.map(range.to, -1)
              return to > from && tr.doc.textBetween(from, to) === range.word ? [{ ...range, from, to }] : []
            })
          },
        },
        props: {
          // The word under the caret is still being typed, so it stays plain
          // until the caret leaves it.
          decorations(state) {
            const { empty, head } = state.selection
            const shown = (key.getState(state) ?? []).filter((r) => !(empty && head >= r.from && head <= r.to))
            return DecorationSet.create(
              state.doc,
              shown.map((r) => Decoration.inline(r.from, r.to, { class: 'spell-error' })),
            )
          },
          handleDOMEvents: {
            contextmenu(view, event) {
              if (!storage.onMenu) return false
              const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
              const range = (key.getState(view.state) ?? []).find((r) => hit && hit.pos >= r.from && hit.pos <= r.to)
              if (!range) return false
              event.preventDefault()
              storage.onMenu({ ...range, x: event.clientX, y: event.clientY, lang: storage.lang })
              return true
            },
          },
        },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | undefined
          let run = 0

          const check = async () => {
            const mine = ++run
            const doc = view.state.doc
            const found = storage.enabled ? collectSpellRanges(doc) : []
            const bad = storage.enabled
              ? await misspelledWords(storage.lang, found.map((r) => r.word))
              : new Set<string>()
            if (mine !== run || view.isDestroyed) return
            if (view.state.doc !== doc) return schedule(0)
            const ranges = found.filter((r) => bad.has(r.word) && !storage.personal.has(r.word.toLowerCase()))
            view.dispatch(view.state.tr.setMeta(key, ranges).setMeta('addToHistory', false))
          }
          const schedule = (delay: number) => {
            clearTimeout(timer)
            timer = setTimeout(() => void check(), delay)
          }

          storage.recheck = () => schedule(0)
          return {
            update(updated, previous) {
              if (updated.state.doc !== previous.doc) schedule(RECHECK_DELAY_MS)
            },
            destroy() {
              run++
              clearTimeout(timer)
              storage.recheck = () => {}
            },
          }
        },
      }),
    ]
  },
})

export function configureSpellcheck(
  editor: Editor,
  options: { enabled: boolean; lang: SpellLanguage; personal: string[] },
): void {
  const storage = editor.storage.spellcheck
  storage.enabled = options.enabled
  storage.lang = options.lang
  storage.personal = new Set(options.personal.map((word) => word.toLowerCase()))
  storage.recheck()
}
