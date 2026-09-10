import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import { codeBlockSourcePath } from '../../lib/codeLinks'
import { useWorkspaceStore } from '../../store/workspace'
import { api } from '../../lib/tauri'
import { isResolved, resolveMissing, getCodeBacklinks, resolveCodeBacklinks } from './CodeLink'
import type { BacklinkEntry } from '../../types'

/**
 * "Open in IDE" on a code block that carries a source path (P7-2), plus the
 * reverse lookup (issue #37): a "N notes" badge next to it when other notes
 * reference the same file, expanding to the list on click.
 *
 * Same recognition idea as P7-1's inline `CodeLink`, applied to a block's
 * first line instead of prose — `// src/main.rs` above a pasted function is
 * how this gets written by hand already. Same launcher, same path
 * resolution, same guardrails: this reuses `CodeLink`'s cache and its
 * `open_in_editor`/`resolve_code_links` backend commands rather than
 * building a second copy of either. The backlinks badge reuses that same
 * cache-and-batch shape, against `code_backlinks_for_with_context` instead.
 *
 * A widget decoration, not a node attribute — nothing new is stored in the
 * document. The path lives in the block's own text, so it already survives
 * save/reload and reads fine in any other Markdown viewer as an ordinary
 * comment line.
 *
 * DoD: the Open button never appears unless the path resolves, and the
 * backlinks badge never appears unless another note actually references it
 * — no disabled/empty state for either, unlike the inline link's "missing"
 * styling.
 */

const codeBlockLinkKey = new PluginKey('codeBlockOpenInIde')

function firstLineSourcePath(node: { textContent: string }) {
  const firstLine = node.textContent.split('\n', 1)[0] ?? ''
  return codeBlockSourcePath(firstLine)
}

/** The "N notes" badge + its dropdown list — issue #37's reverse lookup,
 * surfaced right next to the forward "Open in IDE" button it mirrors. */
function buildBacklinksBadge(target: string, backlinks: BacklinkEntry[]): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'code-block-backlinks'

  const badge = document.createElement('button')
  badge.type = 'button'
  badge.className = 'code-block-backlinks-badge'
  badge.title = `Notes referencing ${target}`
  badge.textContent = backlinks.length === 1 ? '1 note' : `${backlinks.length} notes`
  wrapper.appendChild(badge)

  const dropdown = document.createElement('div')
  dropdown.className = 'code-block-backlinks-dropdown'
  dropdown.hidden = true

  const list = document.createElement('ul')
  list.className = 'backlinks-list'
  for (const { note, snippet } of backlinks) {
    const item = document.createElement('li')
    const itemButton = document.createElement('button')
    itemButton.type = 'button'
    itemButton.className = 'backlink-item'
    itemButton.setAttribute('data-note-path', note.path)

    const title = document.createElement('span')
    title.className = 'backlink-title'
    title.textContent = note.title
    itemButton.appendChild(title)

    if (snippet) {
      const snippetEl = document.createElement('span')
      snippetEl.className = 'backlink-snippet'
      snippetEl.textContent = snippet
      itemButton.appendChild(snippetEl)
    }

    item.appendChild(itemButton)
    list.appendChild(item)
  }
  dropdown.appendChild(list)
  wrapper.appendChild(dropdown)

  return wrapper
}

function decorate(state: EditorState, workspace: string | null, notePath: string): DecorationSet {
  if (!workspace) return DecorationSet.empty

  const decorations: Decoration[] = []

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    const link = firstLineSourcePath(node)
    if (!link || !isResolved(workspace, link.target)) return false

    decorations.push(
      Decoration.widget(
        pos + 1,
        () => {
          const group = document.createElement('div')
          group.className = 'code-block-open-in-ide-group'
          group.contentEditable = 'false'

          // Other notes only — a note referencing its own annotated file
          // elsewhere in its own text isn't the "which other notes" answer
          // this badge exists to give.
          const backlinks = getCodeBacklinks(workspace, link.target).filter(
            (entry) => entry.note.path !== notePath,
          )
          if (backlinks.length > 0) {
            group.appendChild(buildBacklinksBadge(link.target, backlinks))
          }

          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'code-block-open-in-ide'
          button.title = `Open ${link.target} in the configured editor`
          button.textContent = `Open ${link.target}`
          button.setAttribute('data-target', link.target)
          button.setAttribute('data-line', String(link.line ?? ''))
          group.appendChild(button)

          return group
        },
        { side: -1 },
      ),
    )
    return false
  })

  return DecorationSet.create(state.doc, decorations)
}

function collectTargets(state: EditorState): string[] {
  const targets: string[] = []
  state.doc.descendants((node) => {
    if (node.type.name !== 'codeBlock') return true
    const link = firstLineSourcePath(node)
    if (link) targets.push(link.target)
    return false
  })
  return targets
}

function closeAllBacklinkDropdowns(root: Element) {
  root.querySelectorAll<HTMLElement>('.code-block-backlinks-dropdown').forEach((el) => {
    el.hidden = true
  })
}

export const CodeBlockOpenInIde = Extension.create({
  name: 'codeBlockOpenInIde',

  addProseMirrorPlugins() {
    const editor = this.editor
    const notePath = () => editor.storage.noteContext.notePath

    return [
      new Plugin({
        key: codeBlockLinkKey,
        state: {
          init: (_, state) => decorate(state, useWorkspaceStore.getState().path, notePath()),
          apply: (tr, old, _oldState, newState) =>
            tr.docChanged || tr.getMeta(codeBlockLinkKey)
              ? decorate(newState, useWorkspaceStore.getState().path, notePath())
              : old,
        },
        view(view) {
          const onClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null

            const badge = target?.closest?.('.code-block-backlinks-badge')
            if (badge instanceof HTMLElement) {
              event.preventDefault()
              const dropdown = badge.nextElementSibling
              const wasOpen = dropdown instanceof HTMLElement && !dropdown.hidden
              closeAllBacklinkDropdowns(view.dom)
              if (dropdown instanceof HTMLElement && !wasOpen) dropdown.hidden = false
              return
            }

            const item = target?.closest?.('.backlink-item')
            if (item instanceof HTMLElement) {
              event.preventDefault()
              closeAllBacklinkDropdowns(view.dom)
              const notePath = item.getAttribute('data-note-path')
              if (notePath) useWorkspaceStore.getState().openTab(notePath)
              return
            }

            closeAllBacklinkDropdowns(view.dom)

            const el = target?.closest?.('.code-block-open-in-ide')
            if (!(el instanceof HTMLElement)) return
            event.preventDefault()

            const workspace = useWorkspaceStore.getState().path
            const targetPath = el.getAttribute('data-target')
            if (!workspace || !targetPath) return

            const rawLine = el.getAttribute('data-line')
            void api.notes.openInEditor(workspace, targetPath, rawLine ? Number(rawLine) : null)
          }
          view.dom.addEventListener('click', onClick)

          const redraw = () => view.dispatch(view.state.tr.setMeta(codeBlockLinkKey, true))
          const ask = () => {
            const workspace = useWorkspaceStore.getState().path
            if (!workspace) return
            const targets = collectTargets(view.state)
            void resolveMissing(workspace, targets, redraw)
            void resolveCodeBacklinks(workspace, targets, redraw)
          }
          ask()
          return {
            update: ask,
            destroy: () => view.dom.removeEventListener('click', onClick),
          }
        },
        props: {
          decorations(state) {
            return codeBlockLinkKey.getState(state) as DecorationSet
          },
        },
      }),
    ]
  },
})
