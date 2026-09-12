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
 * Three states (issue #52):
 * - `code-link`                 — file found, fingerprint matches (or no line)
 * - `code-link code-link-stale` — file found, but line content has drifted
 * - `code-link code-link-missing` — file not found in workspace (inert)
 *
 * Existence and staleness can't be answered from the document, so they come
 * from a batched backend call whose results are cached per workspace+target+line;
 * a target not yet answered renders inert until it is, which is the safe direction.
 */

const codeLinkKey = new PluginKey('codeLink')

type LinkStatus = 'ok' | 'missing' | 'stale'

/** `workspace\0target\0line` -> resolution status. Module-scoped: the answer
 * is a fact about the disk, not about any one editor instance, and both
 * editors and every tab share it. */
const resolved = new Map<string, LinkStatus>()
const pending = new Set<string>()

function cacheKey(workspace: string, target: string, line: number | null): string {
  return `${workspace}\0${target}\0${line ?? ''}`
}

export function resolveStatus(
  workspace: string,
  target: string,
  line: number | null,
): LinkStatus | undefined {
  return resolved.get(cacheKey(workspace, target, line))
}

/** Back-compat: returns true when the link is known to resolve (ok or stale).
 * Used by CodeBlockOpenInIde which only cares about file existence. */
export function isResolved(workspace: string, target: string): boolean {
  for (const [k, v] of resolved) {
    if (k.startsWith(`${workspace}\0${target}\0`) && v !== 'missing') return true
  }
  return false
}

/** Clears the cache — a workspace switch, or a pull that changed the tree. */
export function forgetResolvedCodeLinks(): void {
  resolved.clear()
  pending.clear()
  codeBacklinks.clear()
  backlinksPending.clear()
}

/** `workspace\0target` -> the notes that reference it (issue #37's reverse
 * lookup), cached the same way `resolved` is. */
const codeBacklinks = new Map<string, BacklinkEntry[]>()
const backlinksPending = new Set<string>()

export function getCodeBacklinks(workspace: string, target: string): BacklinkEntry[] {
  return codeBacklinks.get(`${workspace}\0${target}`) ?? []
}

/**
 * Asks the backend which notes reference each of `targets`, then redraws.
 *
 * Same batching/dedup shape as `resolveMissing`.
 */
export async function resolveCodeBacklinks(
  workspace: string,
  targets: string[],
  redraw: () => void,
): Promise<void> {
  const bKey = (t: string) => `${workspace}\0${t}`
  const unknown = [...new Set(targets)].filter(
    (target) => !codeBacklinks.has(bKey(target)) && !backlinksPending.has(bKey(target)),
  )
  if (unknown.length === 0) return
  unknown.forEach((target) => backlinksPending.add(bKey(target)))

  await Promise.all(
    unknown.map(async (target) => {
      try {
        const entries = await api.notes.codeBacklinksForWithContext(workspace, target)
        codeBacklinks.set(bKey(target), entries)
      } catch {
        codeBacklinks.set(bKey(target), [])
      } finally {
        backlinksPending.delete(bKey(target))
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
 *
 * `notePath` is the currently-open note — the backend uses it to look up the
 * stored fingerprint for staleness comparison (issue #52).
 */
export async function resolveMissing(
  workspace: string,
  notePath: string,
  targets: Array<{ target: string; line: number | null }>,
  redraw: () => void,
): Promise<void> {
  const unknown = targets.filter(
    ({ target, line }) =>
      !resolved.has(cacheKey(workspace, target, line)) &&
      !pending.has(cacheKey(workspace, target, line)),
  )
  const seen = new Set<string>()
  const deduped = unknown.filter(({ target, line }) => {
    const k = cacheKey(workspace, target, line)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (deduped.length === 0) return
  deduped.forEach(({ target, line }) => pending.add(cacheKey(workspace, target, line)))

  try {
    const answers = await api.notes.resolveCodeLinks(workspace, notePath, deduped)
    deduped.forEach(({ target, line }, i) => {
      const raw = answers[i]
      const status: LinkStatus = raw === 'ok' ? 'ok' : raw === 'stale' ? 'stale' : 'missing'
      resolved.set(cacheKey(workspace, target, line), status)
    })
  } catch {
    // A failed lookup leaves every target unresolved, which renders inert —
    // the same outcome as a genuinely missing file, and never a launch.
    deduped.forEach(({ target, line }) =>
      resolved.set(cacheKey(workspace, target, line), 'missing'),
    )
  } finally {
    deduped.forEach(({ target, line }) => pending.delete(cacheKey(workspace, target, line)))
    redraw()
  }
}

function decorate(state: EditorState, workspace: string | null, notePath: string): DecorationSet {
  if (!workspace) return DecorationSet.empty

  const decorations: Decoration[] = []

  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    // A code path inside a code block is source, not a reference to source.
    for (const link of findCodeLinks(node.text)) {
      const status = resolveStatus(workspace, link.target, link.line) ?? 'missing'
      const cls =
        status === 'ok'
          ? 'code-link'
          : status === 'stale'
            ? 'code-link code-link-stale'
            : 'code-link code-link-missing'
      const title =
        status === 'ok'
          ? `Open ${link.target} in the configured editor`
          : status === 'stale'
            ? `${link.target}:${link.line} — line content has changed since this link was written`
            : `${link.target} — not found in this workspace`
      decorations.push(
        Decoration.inline(pos + link.from, pos + link.to, {
          class: cls,
          'data-target': link.target,
          'data-line': String(link.line ?? ''),
          'data-note-path': notePath,
          title,
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
    const notePath = () => this.editor.storage.noteContext.notePath as string

    return [
      new Plugin({
        key: codeLinkKey,
        state: {
          init: (_, state) =>
            decorate(state, useWorkspaceStore.getState().path, notePath()),
          apply: (tr, old, _oldState, newState) =>
            tr.docChanged || tr.getMeta(codeLinkKey)
              ? decorate(newState, useWorkspaceStore.getState().path, notePath())
              : old,
        },
        view(view) {
          // A plain DOM listener rather than ProseMirror's `handleClick`: the
          // decoration is a span and `closest` answers exactly the question
          // being asked, without going through coordinate resolution that adds
          // nothing here.
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
            const targets: Array<{ target: string; line: number | null }> = []
            view.state.doc.descendants((node) => {
              if (node.isText && node.text) {
                findCodeLinks(node.text).forEach(({ target, line }) =>
                  targets.push({ target, line }),
                )
              }
              return true
            })
            void resolveMissing(workspace, notePath(), targets, redraw)
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
