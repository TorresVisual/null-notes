import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import { findCodeLinks } from '../../lib/codeLinks'
import { useWorkspaceStore } from '../../store/workspace'
import { api } from '../../lib/tauri'
import type { BacklinkEntry } from '../../types'

/**
 * Makes `src/main.cpp:58` in note text clickable, opening the configured
 * editor at that file and line.
 *
 * A decoration rather than a node: the link is ordinary Markdown that has to
 * degrade to readable text in any other editor, so nothing may be stored in
 * the document for it. Serialization is untouched — there is nothing to
 * serialize.
 *
 * Unresolved links render inert, exactly like an unresolved `[[wiki-link]]`.
 * Existence can't be answered from the document, so it comes from a batched
 * backend call whose results are cached per workspace; a target not yet
 * answered for renders inert until it is, which is the safe direction.
 */

const codeLinkKey = new PluginKey('codeLink')

/** `workspace\0target` → does it resolve. Module-scoped: the answer is a
 * fact about the disk, not about any one editor instance, and both editors and
 * every tab share it. */
const resolved = new Map<string, boolean>()
const pending = new Set<string>()

function cacheKey(workspace: string, target: string): string {
  return `${workspace}\0${target}`
}

export function isResolved(workspace: string, target: string): boolean {
  return resolved.get(cacheKey(workspace, target)) ?? false
}

/** Clears the cache — a workspace switch, or a pull that changed the tree. */
export function forgetResolvedCodeLinks(): void {
  resolved.clear()
  pending.clear()
  codeBacklinks.clear()
  backlinksPending.clear()
}

/** `workspace\0target` → the notes that reference it (issue #37's reverse
 * lookup), cached the same way `resolved` is — the answer is a fact about
 * the workspace's notes, not about any one editor instance or open tab. */
const codeBacklinks = new Map<string, BacklinkEntry[]>()
const backlinksPending = new Set<string>()

export function getCodeBacklinks(workspace: string, target: string): BacklinkEntry[] {
  return codeBacklinks.get(cacheKey(workspace, target)) ?? []
}

/**
 * Asks the backend which notes reference each of `targets`, then redraws.
 *
 * Same batching/dedup shape as `resolveMissing` — a note full of annotated
 * code blocks must not turn into one IPC round trip per block per render.
 */
export async function resolveCodeBacklinks(
  workspace: string,
  targets: string[],
  redraw: () => void,
): Promise<void> {
  const unknown = [...new Set(targets)].filter(
    (target) =>
      !codeBacklinks.has(cacheKey(workspace, target)) &&
      !backlinksPending.has(cacheKey(workspace, target)),
  )
  if (unknown.length === 0) return
  unknown.forEach((target) => backlinksPending.add(cacheKey(workspace, target)))

  await Promise.all(
    unknown.map(async (target) => {
      try {
        const entries = await api.notes.codeBacklinksForWithContext(workspace, target)
        codeBacklinks.set(cacheKey(workspace, target), entries)
      } catch {
        codeBacklinks.set(cacheKey(workspace, target), [])
      } finally {
        backlinksPending.delete(cacheKey(workspace, target))
      }
    }),
  )
  redraw()
}

/**
 * Asks the backend about targets not yet answered for, then redraws.
 *
 * Batched per call and de-duplicated against what is already in flight, so
 * typing in a note full of links does not produce one IPC round trip per
 * keystroke per link. Exported so `CodeBlockOpenInIde` (P7-2) shares this
 * cache and batching rather than running a second copy against the same
 * backend command.
 */
export async function resolveMissing(
  workspace: string,
  targets: string[],
  redraw: () => void,
): Promise<void> {
  const unknown = [...new Set(targets)].filter(
    (target) => !resolved.has(cacheKey(workspace, target)) && !pending.has(cacheKey(workspace, target)),
  )
  if (unknown.length === 0) return
  unknown.forEach((target) => pending.add(cacheKey(workspace, target)))

  try {
    const answers = await api.notes.resolveCodeLinks(workspace, unknown)
    unknown.forEach((target, i) => resolved.set(cacheKey(workspace, target), answers[i] ?? false))
  } catch {
    // A failed lookup leaves every target unresolved, which renders inert —
    // the same outcome as a genuinely missing file, and never a launch.
    unknown.forEach((target) => resolved.set(cacheKey(workspace, target), false))
  } finally {
    unknown.forEach((target) => pending.delete(cacheKey(workspace, target)))
    redraw()
  }
}

function decorate(state: EditorState, workspace: string | null): DecorationSet {
  if (!workspace) return DecorationSet.empty

  const decorations: Decoration[] = []
  const seen: string[] = []

  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    // A code path inside a code block is source, not a reference to source.
    for (const link of findCodeLinks(node.text)) {
      seen.push(link.target)
      const ok = isResolved(workspace, link.target)
      decorations.push(
        Decoration.inline(pos + link.from, pos + link.to, {
          class: ok ? 'code-link' : 'code-link code-link-missing',
          'data-target': link.target,
          'data-line': String(link.line ?? ''),
          title: ok
            ? `Open ${link.target} in the configured editor`
            : `${link.target} — not found in this workspace`,
        }),
      )
    }
    return true
  })

  return DecorationSet.create(state.doc, decorations)
}

export const CodeLink = Extension.create({
  name: 'codeLink',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeLinkKey,
        state: {
          init: (_, state) => decorate(state, useWorkspaceStore.getState().path),
          apply: (tr, old, _oldState, newState) =>
            tr.docChanged || tr.getMeta(codeLinkKey)
              ? decorate(newState, useWorkspaceStore.getState().path)
              : old,
        },
        view(view) {
          // A plain DOM listener rather than ProseMirror's `handleClick`: the
          // decoration is a span and `closest` answers exactly the question
          // being asked, without going through coordinate resolution that adds
          // nothing here. It is also what the wiki-link and tag node views
          // already do.
          const onClick = (event: MouseEvent) => {
            const el = (event.target as HTMLElement | null)?.closest?.('.code-link')
            if (!(el instanceof HTMLElement)) return
            event.preventDefault()
            // An unresolved link is inert: it says what it points at and does
            // nothing, the same answer an unresolved wiki-link gives.
            if (el.classList.contains('code-link-missing')) return

            const workspace = useWorkspaceStore.getState().path
            const target = el.getAttribute('data-target')
            if (!workspace || !target) return

            const rawLine = el.getAttribute('data-line')
            void api.notes.openInEditor(workspace, target, rawLine ? Number(rawLine) : null)
          }
          view.dom.addEventListener('click', onClick)

          const redraw = () => view.dispatch(view.state.tr.setMeta(codeLinkKey, true))
          const ask = () => {
            const workspace = useWorkspaceStore.getState().path
            if (!workspace) return
            const targets: string[] = []
            view.state.doc.descendants((node) => {
              if (node.isText && node.text) {
                findCodeLinks(node.text).forEach((link) => targets.push(link.target))
              }
              return true
            })
            void resolveMissing(workspace, targets, redraw)
          }
          ask()
          return {
            update: ask,
            destroy: () => view.dom.removeEventListener('click', onClick),
          }
        },
        props: {
          decorations(state) {
            return codeLinkKey.getState(state) as DecorationSet
          },
        },
      }),
    ]
  },
})
