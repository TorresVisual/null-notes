import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import { findCrossRefs, type CrossRef as CrossRefMatch } from '../../lib/crossRefs'
import { useWorkspaceStore } from '../../store/workspace'
import { api } from '../../lib/tauri'

/**
 * P6-7: makes `Theorem 3.2` in note text clickable, jumping to whichever
 * numbered `Callout` block (in this note or any other) actually carries
 * that type and number.
 *
 * Same shape as `CodeLink` (P7-1) throughout: a decoration rather than a
 * node — the reference is ordinary prose, nothing new to serialize —
 * resolved via a batched, cached backend call, and an unresolved reference
 * renders inert rather than guessing at the wrong block.
 */

const crossRefKey = new PluginKey('crossRef')

/** `workspace\0type\0number` → the note path that defines it, or `null`
 * once confirmed absent. Module-scoped, like `CodeLink`'s cache: the answer
 * is a fact about the workspace, not about any one editor instance. */
const resolved = new Map<string, string | null>()
const pending = new Set<string>()

function cacheKey(workspace: string, calloutType: string, number: string): string {
  return `${workspace}\0${calloutType}\0${number}`
}

export function resolvedPath(workspace: string, calloutType: string, number: string): string | null {
  return resolved.get(cacheKey(workspace, calloutType, number)) ?? null
}

/** Clears the cache — a workspace switch, or a pull that changed the tree. */
export function forgetResolvedCrossRefs(): void {
  resolved.clear()
  pending.clear()
}

/** Asks the backend about refs not yet answered for, then redraws. Batched
 * and de-duplicated against what's already in flight, mirroring
 * `CodeLink.resolveMissing`. */
export async function resolveMissing(
  workspace: string,
  refs: CrossRefMatch[],
  redraw: () => void,
): Promise<void> {
  const seen = new Set<string>()
  const unknown: CrossRefMatch[] = []
  for (const ref of refs) {
    const key = cacheKey(workspace, ref.calloutType, ref.number)
    if (seen.has(key) || resolved.has(key) || pending.has(key)) continue
    seen.add(key)
    unknown.push(ref)
  }
  if (unknown.length === 0) return
  unknown.forEach((ref) => pending.add(cacheKey(workspace, ref.calloutType, ref.number)))

  try {
    const answers = await api.notes.resolveCrossRefs(
      workspace,
      unknown.map(({ calloutType, number }) => ({ calloutType, number })),
    )
    unknown.forEach((ref, i) =>
      resolved.set(cacheKey(workspace, ref.calloutType, ref.number), answers[i] ?? null),
    )
  } catch {
    // A failed lookup leaves every ref unresolved — inert, the same outcome
    // as a genuinely missing block, and never a jump to the wrong one.
    unknown.forEach((ref) => resolved.set(cacheKey(workspace, ref.calloutType, ref.number), null))
  } finally {
    unknown.forEach((ref) => pending.delete(cacheKey(workspace, ref.calloutType, ref.number)))
    redraw()
  }
}

function decorate(state: EditorState, workspace: string | null): DecorationSet {
  if (!workspace) return DecorationSet.empty

  const decorations: Decoration[] = []
  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    for (const ref of findCrossRefs(node.text)) {
      const path = resolvedPath(workspace, ref.calloutType, ref.number)
      decorations.push(
        Decoration.inline(pos + ref.from, pos + ref.to, {
          class: path ? 'cross-ref' : 'cross-ref cross-ref-missing',
          'data-callout-type': ref.calloutType,
          'data-number': ref.number,
          'data-path': path ?? '',
          title: path
            ? `Jump to ${ref.calloutType} ${ref.number}`
            : `${ref.calloutType} ${ref.number} — not found in this workspace`,
        }),
      )
    }
    return true
  })

  return DecorationSet.create(state.doc, decorations)
}

/** Scrolls to and briefly highlights the numbered callout, once it exists
 * in the DOM. The target note may still be loading — a fresh tab opened by
 * this same click, or the same note re-rendering — so this retries across a
 * bounded number of frames rather than giving up on the first miss. */
function scrollToBlock(calloutType: string, number: string, attempt = 0): void {
  const el = document.querySelector<HTMLElement>(
    `.callout[data-callout-type="${calloutType}"][data-callout-number="${number}"]`,
  )
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('cross-ref-target')
    setTimeout(() => el.classList.remove('cross-ref-target'), 1500)
    return
  }
  if (attempt < 90) requestAnimationFrame(() => scrollToBlock(calloutType, number, attempt + 1))
}

export const CrossRef = Extension.create({
  name: 'crossRef',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: crossRefKey,
        state: {
          init: (_, state) => decorate(state, useWorkspaceStore.getState().path),
          apply: (tr, old, _oldState, newState) =>
            tr.docChanged || tr.getMeta(crossRefKey)
              ? decorate(newState, useWorkspaceStore.getState().path)
              : old,
        },
        view(view) {
          const onClick = (event: MouseEvent) => {
            const el = (event.target as HTMLElement | null)?.closest?.('.cross-ref')
            if (!(el instanceof HTMLElement)) return
            event.preventDefault()
            // Unresolved is inert — the same answer an unresolved wiki-link
            // or code link already gives.
            if (el.classList.contains('cross-ref-missing')) return

            const path = el.getAttribute('data-path')
            const calloutType = el.getAttribute('data-callout-type')
            const number = el.getAttribute('data-number')
            if (!path || !calloutType || !number) return

            useWorkspaceStore.getState().openTab(path)
            scrollToBlock(calloutType, number)
          }
          view.dom.addEventListener('click', onClick)

          const redraw = () => view.dispatch(view.state.tr.setMeta(crossRefKey, true))
          const ask = () => {
            const workspace = useWorkspaceStore.getState().path
            if (!workspace) return
            const refs: CrossRefMatch[] = []
            view.state.doc.descendants((node) => {
              if (node.isText && node.text) refs.push(...findCrossRefs(node.text))
              return true
            })
            void resolveMissing(workspace, refs, redraw)
          }
          ask()
          return {
            update: ask,
            destroy: () => view.dom.removeEventListener('click', onClick),
          }
        },
        props: {
          decorations(state) {
            return crossRefKey.getState(state) as DecorationSet
          },
        },
      }),
    ]
  },
})
