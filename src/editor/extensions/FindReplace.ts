import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { revealPos } from './Folding'

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
 * Equations (`InlineMath`/`BlockMath`) store LaTeX as a node attribute, not
 * ProseMirror text, so a match there highlights the whole atom node
 * (`Decoration.node`) rather than a sub-string span — there's no
 * addressable position inside a KaTeX-rendered atom to highlight a range
 * within. Replace/replace-all only ever touch `kind: 'text'` matches;
 * editing LaTeX source through find/replace isn't supported.
 *
 * The bar's own DOM lives OUTSIDE `view.dom` — appended as a sibling of
 * `.editor-scroll` inside `.editor-body`, the same anchor `.outline-panel`
 * uses to float over the note regardless of scroll position, and
 * `position: absolute` (not `sticky`) for the same reason `.outline-panel`
 * doesn't use sticky either: `position: sticky` measurably fails to hold
 * anywhere in this layout once the note is genuinely scrolled, not just
 * inside a ProseMirror decoration widget — confirmed via e2e against
 * `.editor-toolbar` itself (a plain DOM sibling, nothing to do with
 * `contenteditable`), which renders ~570px off-screen after a real scroll
 * despite `getComputedStyle` reporting `position: sticky` correctly. Chasing
 * *why* sticky fails this deep in the flex/overflow chain is a separate,
 * pre-existing bug; an absolutely-positioned sibling of the non-scrolling
 * `.editor-body` sidesteps it by construction. `.editor-body` spans the
 * full scroll width, not `.editor-pane`'s centered content column, so the
 * bar's CSS re-centers itself to that same column and insets by the same
 * 48px padding `.editor-pane` uses, so it lines up with the toolbar above
 * it instead of hanging off the raw edge.
 */

const findReplaceKey = new PluginKey<FindReplaceState | null>('findReplace')

interface FindReplaceState {
  query: string
  replacement: string
  replaceVisible: boolean
  activeIndex: number
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
}

type ToggleOption = 'caseSensitive' | 'wholeWord' | 'useRegex'

type FindReplaceMeta =
  | { type: 'open' }
  | { type: 'query'; query: string }
  | { type: 'replacement'; replacement: string }
  | { type: 'toggleReplace' }
  | { type: 'toggleOption'; option: ToggleOption }
  | { type: 'nav'; delta: number }
  | { type: 'close' }

export interface DocMatch {
  from: number
  to: number
  kind: 'text' | 'node'
}

export interface QueryOptions {
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
}

const defaultQueryOptions: QueryOptions = { caseSensitive: false, wholeWord: false, useRegex: false }

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Builds the query into a `RegExp`, honoring case/whole-word/regex options.
 *  Returns `{ error }` instead of throwing when `useRegex` produces an
 *  invalid pattern, so callers (decoration + bar UI) can show that inline
 *  rather than crash mid-keystroke. */
export function buildQueryRegex(
  query: string,
  options: QueryOptions,
): { regex: RegExp; error?: undefined } | { regex?: undefined; error: string } {
  const source = options.useRegex ? query : escapeRegExp(query)
  const bounded = options.wholeWord ? `\\b(?:${source})\\b` : source
  try {
    return { regex: new RegExp(bounded, options.caseSensitive ? 'g' : 'gi') }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid regular expression' }
  }
}

const mathNodeNames = new Set(['inlineMath', 'blockMath'])

/** Every match of `query` in `doc`, in document order — prose and code
 *  block text as inline sub-string matches, `inlineMath`/`blockMath` nodes
 *  as whole-node matches when the query is found in their LaTeX source (see
 *  file header for why those can't be sub-string matches). Positions are
 *  real document offsets, ready for a transaction. */
export function findDocMatches(
  doc: ProseMirrorNode,
  query: string,
  options: QueryOptions = defaultQueryOptions,
): DocMatch[] {
  if (!query) return []
  const { regex } = buildQueryRegex(query, options)
  if (!regex) return []

  const matches: DocMatch[] = []

  doc.descendants((node, pos) => {
    if (mathNodeNames.has(node.type.name)) {
      regex.lastIndex = 0
      if (regex.test((node.attrs.latex as string) ?? '')) matches.push({ from: pos, to: pos + node.nodeSize, kind: 'node' })
      return false
    }
    if (!node.isText) return true

    const text = node.text ?? ''
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text))) {
      matches.push({ from: pos + match.index, to: pos + match.index + match[0].length, kind: 'text' })
      // A zero-length match (e.g. a regex like `x?`) would otherwise pin
      // lastIndex in place and loop forever.
      if (match[0].length === 0) regex.lastIndex++
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
  // one (position-wise) has already been replaced. Node-kind (math) matches
  // never take part — replacing a whole equation with the plain-text
  // replacement string isn't a supported operation.
  const orderedLastFirst = matches.filter((m) => m.kind === 'text').sort((a, b) => b.from - a.from)
  for (const match of orderedLastFirst) replaceOne(tr, match, replacement)
}

function apply(tr: Transaction, value: FindReplaceState | null): FindReplaceState | null {
  const meta = tr.getMeta(findReplaceKey) as FindReplaceMeta | undefined
  if (meta) {
    if (meta.type === 'close') return null
    if (meta.type === 'open') {
      return { query: '', replacement: '', replaceVisible: false, activeIndex: 0, caseSensitive: false, wholeWord: false, useRegex: false }
    }
    if (!value) return value
    if (meta.type === 'query') return { ...value, query: meta.query, activeIndex: 0 }
    if (meta.type === 'replacement') return { ...value, replacement: meta.replacement }
    if (meta.type === 'toggleReplace') return { ...value, replaceVisible: !value.replaceVisible }
    if (meta.type === 'toggleOption') return { ...value, [meta.option]: !value[meta.option], activeIndex: 0 }
    // 'nav'
    const count = findDocMatches(tr.doc, value.query, value).length
    return { ...value, activeIndex: wrapIndex(value.activeIndex + meta.delta, count) }
  }
  return value
}

function findBar(): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'note-find-bar'
  bar.hidden = true
  bar.innerHTML = `
    <div class="note-find-row">
      <button type="button" class="note-find-toggle-replace" title="Toggle replace">▾</button>
      <input type="text" class="note-find-input" placeholder="Find in note">
      <button type="button" class="note-find-option" data-option="caseSensitive" title="Match case">Aa</button>
      <button type="button" class="note-find-option" data-option="wholeWord" title="Whole word">ab</button>
      <button type="button" class="note-find-option" data-option="useRegex" title="Use regular expression">.*</button>
      <span class="note-find-count"></span>
      <button type="button" class="note-find-nav" title="Previous match (Shift+Enter)">↑</button>
      <button type="button" class="note-find-nav" title="Next match (Enter)">↓</button>
      <button type="button" class="note-find-close" title="Close (Esc)">×</button>
    </div>
    <div class="note-find-replace-row" hidden>
      <input type="text" class="note-find-replace-input" placeholder="Replace with">
      <button type="button" class="note-find-replace-one">Replace</button>
      <button type="button" class="note-find-replace-all">Replace all</button>
    </div>
  `
  return bar
}

function decorate(state: EditorState): DecorationSet {
  const value = findReplaceKey.getState(state)
  if (!value) return DecorationSet.empty

  const matches = findDocMatches(state.doc, value.query, value)
  const activeIndex = wrapIndex(value.activeIndex, matches.length)

  const decorations = matches.map((match, index) => {
    const cls = index === activeIndex ? 'note-find-match note-find-match-active' : 'note-find-match'
    return match.kind === 'node'
      ? Decoration.node(match.from, match.to, { class: cls })
      : Decoration.inline(match.from, match.to, { class: cls })
  })

  return DecorationSet.create(state.doc, decorations)
}

function syncFindBarUi(view: EditorView, bar: HTMLElement) {
  const value = findReplaceKey.getState(view.state)
  bar.hidden = !value
  if (!value) return

  const matches = findDocMatches(view.state.doc, value.query, value)
  const activeIndex = wrapIndex(value.activeIndex, matches.length)
  const { error } = buildQueryRegex(value.query, value)
  const invalid = !!value.query && !!error

  const input = bar.querySelector('.note-find-input')
  if (input instanceof HTMLElement) input.classList.toggle('invalid', invalid)

  const count = bar.querySelector('.note-find-count')
  if (count) {
    count.textContent = invalid ? 'Invalid regex' : value.query ? `${matches.length ? activeIndex + 1 : 0}/${matches.length}` : ''
    count.classList.toggle('note-find-count-error', invalid)
  }

  const replaceRow = bar.querySelector('.note-find-replace-row')
  if (replaceRow instanceof HTMLElement) replaceRow.hidden = !value.replaceVisible

  const toggle = bar.querySelector('.note-find-toggle-replace')
  if (toggle) toggle.textContent = value.replaceVisible ? '▴' : '▾'

  for (const option of ['caseSensitive', 'wholeWord', 'useRegex'] as const) {
    bar.querySelector(`.note-find-option[data-option="${option}"]`)?.classList.toggle('active', value[option])
  }

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
          const dispatchMeta = (meta: FindReplaceMeta) => {
            view.dispatch(view.state.tr.setMeta(findReplaceKey, meta))
            if (meta.type !== 'query' && meta.type !== 'nav' && meta.type !== 'toggleOption') return
            const value = findReplaceKey.getState(view.state)
            if (!value) return
            const matches = findDocMatches(view.state.doc, value.query, value)
            const active = matches[wrapIndex(value.activeIndex, matches.length)]
            if (active) revealPos(view, active.from)
          }

          const bar = findBar()
          const paneEl = view.dom.closest<HTMLElement>('.editor-pane')
          const host = paneEl?.closest<HTMLElement>('.editor-body') ?? view.dom.parentElement ?? view.dom
          host.appendChild(bar)

          // The bar's box must line up with `.editor-pane`'s exactly — see
          // index.css's `.note-find-bar` comment for why that can't be done
          // with CSS alone (a scrollbar, or the user's editor-width
          // setting, both shift `.editor-pane` in ways this sibling can't
          // see). Mirroring the pane's own rendered rect sidesteps having
          // to duplicate that math and stays correct if it ever changes.
          const syncGeometry = () => {
            if (!paneEl) return
            const paneRect = paneEl.getBoundingClientRect()
            const hostRect = host.getBoundingClientRect()
            bar.style.left = `${paneRect.left - hostRect.left}px`
            bar.style.width = `${paneRect.width}px`
          }
          syncGeometry()
          window.addEventListener('resize', syncGeometry)

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
            if (button.classList.contains('note-find-option')) {
              const option = button.dataset.option as ToggleOption | undefined
              if (option) dispatchMeta({ type: 'toggleOption', option })
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
              const matches = findDocMatches(view.state.doc, value.query, value)
              const match = matches[wrapIndex(value.activeIndex, matches.length)]
              if (!match || match.kind !== 'text') return
              const tr = view.state.tr
              replaceOne(tr, match, value.replacement)
              view.dispatch(tr)
              return
            }
            if (button.classList.contains('note-find-replace-all')) {
              const matches = findDocMatches(view.state.doc, value.query, value)
              if (matches.length === 0) return
              const tr = view.state.tr
              replaceAll(tr, matches, value.replacement)
              view.dispatch(tr)
            }
          }

          bar.addEventListener('input', onInput)
          bar.addEventListener('keydown', onKeydown)
          bar.addEventListener('click', onClick)

          let wasOpen = false

          return {
            update(view) {
              syncFindBarUi(view, bar)
              const isOpen = !!findReplaceKey.getState(view.state)
              if (isOpen && !wasOpen) {
                syncGeometry()
                requestAnimationFrame(() => bar.querySelector<HTMLInputElement>('.note-find-input')?.focus({ preventScroll: true }))
              }
              wasOpen = isOpen
            },
            destroy: () => {
              window.removeEventListener('resize', syncGeometry)
              bar.removeEventListener('input', onInput)
              bar.removeEventListener('keydown', onKeydown)
              bar.removeEventListener('click', onClick)
              bar.remove()
            },
          }
        },
      }),
    ]
  },
})
