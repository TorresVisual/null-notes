import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

/**
 * P11-3: `Ctrl+F` inside a focused code block searches only that block's
 * text — never the whole note, and never WebView2's own native find dialog
 * (which a code block's `Ctrl+F` would otherwise trigger, since nothing in
 * this app currently intercepts it).
 *
 * The query lives in plugin state (not just the input's own DOM value)
 * because `decorations(state)` — where the match highlights come from —
 * only ever receives `state`, never the live view/DOM. The search bar
 * itself is a *persistent* widget, not rebuilt on every keystroke like
 * `CodeBlockToolbar`'s buttons: its `Decoration.widget` carries a stable
 * `key`, so ProseMirror reuses the same DOM node (and the input keeps
 * focus and cursor position) across every query/nav update. What that
 * widget's factory can't do — update its own counter text after the fact,
 * since it only runs once — happens imperatively in this plugin's `view()`
 * hook instead, the same idiom `CodeBlockOpenInIde.ts`'s ask/redraw cycle
 * already uses.
 */

const codeBlockSearchKey = new PluginKey<SearchState | null>('codeBlockSearch')

interface SearchState {
  pos: number
  query: string
  activeIndex: number
}

type SearchMeta =
  | { type: 'open'; pos: number }
  | { type: 'query'; query: string }
  | { type: 'nav'; delta: number }
  | { type: 'close' }

/** Case-insensitive, non-overlapping match start offsets within `text`. */
export function findMatches(text: string, query: string): number[] {
  if (!query) return []
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const offsets: number[] = []
  let from = 0
  for (;;) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) break
    offsets.push(index)
    from = index + needle.length
  }
  return offsets
}

function codeBlockTextAt(doc: ProseMirrorNode, pos: number): string | null {
  const node = doc.nodeAt(pos)
  return node && node.type.name === 'codeBlock' ? node.textContent : null
}

function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return ((index % count) + count) % count
}

function apply(tr: Transaction, value: SearchState | null): SearchState | null {
  const meta = tr.getMeta(codeBlockSearchKey) as SearchMeta | undefined
  if (meta) {
    if (meta.type === 'close') return null
    if (meta.type === 'open') return { pos: meta.pos, query: '', activeIndex: 0 }
    if (!value) return value
    if (meta.type === 'query') return { ...value, query: meta.query, activeIndex: 0 }
    // 'nav'
    const text = codeBlockTextAt(tr.doc, value.pos) ?? ''
    const count = findMatches(text, value.query).length
    return { ...value, activeIndex: wrapIndex(value.activeIndex + meta.delta, count) }
  }

  if (!value) return value
  if (!tr.docChanged) return value

  const mapped = tr.mapping.map(value.pos)
  if (codeBlockTextAt(tr.doc, mapped) === null) return null
  return mapped === value.pos ? value : { ...value, pos: mapped }
}

function searchBar(view: EditorView): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'code-search-bar'
  bar.contentEditable = 'false'

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'code-search-input'
  input.placeholder = 'Find in block'
  bar.appendChild(input)

  const count = document.createElement('span')
  count.className = 'code-search-count'
  bar.appendChild(count)

  const prev = document.createElement('button')
  prev.type = 'button'
  prev.className = 'code-search-nav'
  prev.textContent = '↑'
  prev.title = 'Previous match (Shift+Enter)'
  bar.appendChild(prev)

  const next = document.createElement('button')
  next.type = 'button'
  next.className = 'code-search-nav'
  next.textContent = '↓'
  next.title = 'Next match (Enter)'
  bar.appendChild(next)

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'code-search-close'
  close.textContent = '×'
  close.title = 'Close (Esc)'
  bar.appendChild(close)

  const dispatchMeta = (meta: SearchMeta) => view.dispatch(view.state.tr.setMeta(codeBlockSearchKey, meta))

  input.addEventListener('input', () => dispatchMeta({ type: 'query', query: input.value }))
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      dispatchMeta({ type: 'nav', delta: event.shiftKey ? -1 : 1 })
    } else if (event.key === 'Escape') {
      event.preventDefault()
      dispatchMeta({ type: 'close' })
      view.focus()
    }
  })
  prev.addEventListener('click', () => dispatchMeta({ type: 'nav', delta: -1 }))
  next.addEventListener('click', () => dispatchMeta({ type: 'nav', delta: 1 }))
  close.addEventListener('click', () => {
    dispatchMeta({ type: 'close' })
    view.focus()
  })

  // Autofocus on open — mirrors why this file exists: the user just pressed
  // Ctrl+F expecting to type immediately, not click into a box first.
  requestAnimationFrame(() => input.focus())

  return bar
}

function decorate(state: EditorState): DecorationSet {
  const value = codeBlockSearchKey.getState(state)
  if (!value) return DecorationSet.empty

  const text = codeBlockTextAt(state.doc, value.pos)
  if (text === null) return DecorationSet.empty

  const matches = findMatches(text, value.query)
  const activeIndex = wrapIndex(value.activeIndex, matches.length)
  const base = value.pos + 1

  const decorations = matches.map((offset, index) =>
    Decoration.inline(base + offset, base + offset + value.query.length, {
      class: index === activeIndex ? 'code-search-match code-search-match-active' : 'code-search-match',
    }),
  )

  decorations.push(
    Decoration.widget(base, searchBar, { key: 'code-search-bar', side: -1, ignoreSelection: true, stopEvent: () => true }),
  )

  return DecorationSet.create(state.doc, decorations)
}

function syncSearchBarUi(view: EditorView) {
  const value = codeBlockSearchKey.getState(view.state)
  const bar = view.dom.querySelector('.code-search-bar')
  if (!value || !(bar instanceof HTMLElement)) return

  const text = codeBlockTextAt(view.state.doc, value.pos) ?? ''
  const matches = findMatches(text, value.query)
  const activeIndex = wrapIndex(value.activeIndex, matches.length)

  const count = bar.querySelector('.code-search-count')
  if (count) count.textContent = value.query ? `${matches.length ? activeIndex + 1 : 0}/${matches.length}` : ''

  const active = view.dom.querySelector('.code-search-match-active')
  active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

export const CodeBlockSearch = Extension.create({
  name: 'codeBlockSearch',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeBlockSearchKey,
        state: {
          init: () => null,
          apply,
        },
        props: {
          handleKeyDown: (view, event) => {
            const isFind = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f'
            if (isFind) {
              const { $from } = view.state.selection
              if ($from.parent.type.name !== 'codeBlock') return false
              event.preventDefault()
              view.dispatch(view.state.tr.setMeta(codeBlockSearchKey, { type: 'open', pos: $from.before($from.depth) }))
              return true
            }

            if (event.key === 'Escape' && codeBlockSearchKey.getState(view.state)) {
              event.preventDefault()
              view.dispatch(view.state.tr.setMeta(codeBlockSearchKey, { type: 'close' }))
              return true
            }

            return false
          },
          decorations(state) {
            return decorate(state)
          },
        },
        view() {
          return { update: syncSearchBarUi }
        },
      }),
    ]
  },
})
