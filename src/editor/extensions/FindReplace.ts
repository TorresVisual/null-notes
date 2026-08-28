import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Note-wide find/replace (`Ctrl+F`), a sibling of `CodeBlockSearch.ts`'s
 * in-block find rather than a replacement for it: this one claims `Ctrl+F`
 * only when the caret is *not* inside a code block, so the two compose
 * with no change to that file — inside a block, its own bar wins; outside,
 * this one does.
 *
 * Matches are recomputed live from `state.doc` + the query on every
 * decoration pass, so — unlike `CodeBlockSearch`'s single anchored
 * position — there is nothing to remap on `docChanged`; a stale match
 * simply isn't found again next pass.
 *
 * Equations (`InlineMath`/`BlockMath` store LaTeX as a node attribute, not
 * ProseMirror text) and code blocks (already have their own find/replace
 * surface) are not reachable by this search — a deliberate scope limit,
 * not an oversight.
 */

const findReplaceKey = new PluginKey<FindReplaceState | null>('findReplace')

interface FindReplaceState {
  query: string
  replacement: string
  replaceVisible: boolean
  activeIndex: number
}

type FindReplaceMeta =
  | { type: 'open' }
  | { type: 'query'; query: string }
  | { type: 'replacement'; replacement: string }
  | { type: 'toggleReplace' }
  | { type: 'nav'; delta: number }
  | { type: 'close' }

export interface DocMatch {
  from: number
  to: number
}

/** Every case-insensitive, non-overlapping occurrence of `query` in `doc`'s
 *  text, in document order — skipping code blocks entirely (see the file
 *  header). Positions are real document offsets, ready for a transaction. */
export function findDocMatches(doc: ProseMirrorNode, query: string): DocMatch[] {
  if (!query) return []
  const needle = query.toLowerCase()
  const matches: DocMatch[] = []

  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') return false
    if (!node.isText) return true

    const haystack = (node.text ?? '').toLowerCase()
    let from = 0
    for (;;) {
      const index = haystack.indexOf(needle, from)
      if (index === -1) break
      matches.push({ from: pos + index, to: pos + index + query.length })
      from = index + needle.length
    }
    return true
  })

  return matches
}

function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return ((index % count) + count) % count
}

function replaceOne(tr: Transaction, match: DocMatch, replacement: string): void {
  tr.insertText(replacement, match.from, match.to)
}

function replaceAll(tr: Transaction, matches: DocMatch[], replacement: string): void {
  // Last to first so an earlier match's offsets stay valid after a later
  // one (position-wise) has already been replaced.
  const orderedLastFirst = [...matches].sort((a, b) => b.from - a.from)
  for (const match of orderedLastFirst) replaceOne(tr, match, replacement)
}

function apply(tr: Transaction, value: FindReplaceState | null): FindReplaceState | null {
  const meta = tr.getMeta(findReplaceKey) as FindReplaceMeta | undefined
  if (meta) {
    if (meta.type === 'close') return null
    if (meta.type === 'open') return { query: '', replacement: '', replaceVisible: false, activeIndex: 0 }
    if (!value) return value
    if (meta.type === 'query') return { ...value, query: meta.query, activeIndex: 0 }
    if (meta.type === 'replacement') return { ...value, replacement: meta.replacement }
    if (meta.type === 'toggleReplace') return { ...value, replaceVisible: !value.replaceVisible }
    // 'nav'
    const count = findDocMatches(tr.doc, value.query).length
    return { ...value, activeIndex: wrapIndex(value.activeIndex + meta.delta, count) }
  }
  return value
}

function findBar(): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'note-find-bar'
  bar.contentEditable = 'false'

  const row = document.createElement('div')
  row.className = 'note-find-row'
  bar.appendChild(row)

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'note-find-toggle-replace'
  toggle.title = 'Toggle replace'
  toggle.textContent = '▾'
  row.appendChild(toggle)

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'note-find-input'
  input.placeholder = 'Find in note'
  row.appendChild(input)

  const count = document.createElement('span')
  count.className = 'note-find-count'
  row.appendChild(count)

  const prev = document.createElement('button')
  prev.type = 'button'
  prev.className = 'note-find-nav'
  prev.textContent = '↑'
  prev.title = 'Previous match (Shift+Enter)'
  row.appendChild(prev)

  const next = document.createElement('button')
  next.type = 'button'
  next.className = 'note-find-nav'
  next.textContent = '↓'
  next.title = 'Next match (Enter)'
  row.appendChild(next)

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'note-find-close'
  close.textContent = '×'
  close.title = 'Close (Esc)'
  row.appendChild(close)

  const replaceRow = document.createElement('div')
  replaceRow.className = 'note-find-replace-row'
  replaceRow.hidden = true
  bar.appendChild(replaceRow)

  const replaceInput = document.createElement('input')
  replaceInput.type = 'text'
  replaceInput.className = 'note-find-replace-input'
  replaceInput.placeholder = 'Replace with'
  replaceRow.appendChild(replaceInput)

  const replaceOneBtn = document.createElement('button')
  replaceOneBtn.type = 'button'
  replaceOneBtn.className = 'note-find-replace-one'
  replaceOneBtn.textContent = 'Replace'
  replaceRow.appendChild(replaceOneBtn)

  const replaceAllBtn = document.createElement('button')
  replaceAllBtn.type = 'button'
  replaceAllBtn.className = 'note-find-replace-all'
  replaceAllBtn.textContent = 'Replace all'
  replaceRow.appendChild(replaceAllBtn)

  requestAnimationFrame(() => input.focus())

  return bar
}

function decorate(state: EditorState): DecorationSet {
  const value = findReplaceKey.getState(state)
  if (!value) return DecorationSet.empty

  const matches = findDocMatches(state.doc, value.query)
  const activeIndex = wrapIndex(value.activeIndex, matches.length)

  const decorations = matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class: index === activeIndex ? 'note-find-match note-find-match-active' : 'note-find-match',
    }),
  )

  decorations.push(Decoration.widget(0, findBar, { key: 'note-find-bar', side: -1, ignoreSelection: true, stopEvent: () => true }))

  return DecorationSet.create(state.doc, decorations)
}

function syncFindBarUi(view: EditorView) {
  const value = findReplaceKey.getState(view.state)
  const bar = view.dom.querySelector('.note-find-bar')
  if (!value || !(bar instanceof HTMLElement)) return

  const matches = findDocMatches(view.state.doc, value.query)
  const activeIndex = wrapIndex(value.activeIndex, matches.length)

  const count = bar.querySelector('.note-find-count')
  if (count) count.textContent = value.query ? `${matches.length ? activeIndex + 1 : 0}/${matches.length}` : ''

  const replaceRow = bar.querySelector('.note-find-replace-row')
  if (replaceRow instanceof HTMLElement) replaceRow.hidden = !value.replaceVisible

  const toggle = bar.querySelector('.note-find-toggle-replace')
  if (toggle) toggle.textContent = value.replaceVisible ? '▴' : '▾'

  const active = view.dom.querySelector('.note-find-match-active')
  active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findReplaceKey,
        state: {
          init: () => null,
          apply,
        },
        props: {
          handleKeyDown: (view, event) => {
            const isFind = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f'
            if (isFind) {
              if (view.state.selection.$from.parent.type.name === 'codeBlock') return false
              event.preventDefault()
              view.dispatch(view.state.tr.setMeta(findReplaceKey, { type: 'open' }))
              return true
            }

            if (event.key === 'Escape' && findReplaceKey.getState(view.state)) {
              event.preventDefault()
              view.dispatch(view.state.tr.setMeta(findReplaceKey, { type: 'close' }))
              return true
            }

            return false
          },
          decorations(state) {
            return decorate(state)
          },
        },
        view(view: EditorView) {
          const dispatchMeta = (meta: FindReplaceMeta) => view.dispatch(view.state.tr.setMeta(findReplaceKey, meta))

          const onInput = (event: Event) => {
            const target = event.target as HTMLElement | null
            if (target?.classList?.contains('note-find-input')) {
              dispatchMeta({ type: 'query', query: (target as HTMLInputElement).value })
            } else if (target?.classList?.contains('note-find-replace-input')) {
              dispatchMeta({ type: 'replacement', replacement: (target as HTMLInputElement).value })
            }
          }

          const onKeydown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null
            if (!target?.classList?.contains('note-find-input')) return
            if (event.key === 'Enter') {
              event.preventDefault()
              dispatchMeta({ type: 'nav', delta: event.shiftKey ? -1 : 1 })
            } else if (event.key === 'Escape') {
              event.preventDefault()
              dispatchMeta({ type: 'close' })
              view.focus()
            }
          }

          const onClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null
            const button = target?.closest?.('button')
            if (!(button instanceof HTMLElement)) return

            if (button.classList.contains('note-find-toggle-replace')) {
              dispatchMeta({ type: 'toggleReplace' })
              return
            }
            if (button.classList.contains('note-find-nav')) {
              dispatchMeta({ type: 'nav', delta: button.textContent === '↑' ? -1 : 1 })
              return
            }
            if (button.classList.contains('note-find-close')) {
              dispatchMeta({ type: 'close' })
              view.focus()
              return
            }

            const value = findReplaceKey.getState(view.state)
            if (!value) return

            if (button.classList.contains('note-find-replace-one')) {
              const matches = findDocMatches(view.state.doc, value.query)
              const match = matches[wrapIndex(value.activeIndex, matches.length)]
              if (!match) return
              const tr = view.state.tr
              replaceOne(tr, match, value.replacement)
              view.dispatch(tr)
              return
            }
            if (button.classList.contains('note-find-replace-all')) {
              const matches = findDocMatches(view.state.doc, value.query)
              if (matches.length === 0) return
              const tr = view.state.tr
              replaceAll(tr, matches, value.replacement)
              view.dispatch(tr)
            }
          }

          view.dom.addEventListener('input', onInput)
          view.dom.addEventListener('keydown', onKeydown)
          view.dom.addEventListener('click', onClick)

          return {
            update: syncFindBarUi,
            destroy: () => {
              view.dom.removeEventListener('input', onInput)
              view.dom.removeEventListener('keydown', onKeydown)
              view.dom.removeEventListener('click', onClick)
            },
          }
        },
      }),
    ]
  },
})
