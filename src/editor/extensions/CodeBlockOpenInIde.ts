import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import { codeBlockSourcePath } from '../../lib/codeLinks'
import { useWorkspaceStore } from '../../store/workspace'
import { api } from '../../lib/tauri'
import { isResolved, resolveMissing } from './CodeLink'

/**
 * "Open in IDE" on a code block that carries a source path (P7-2).
 *
 * Same recognition idea as P7-1's inline `CodeLink`, applied to a block's
 * first line instead of prose — `// src/main.rs` above a pasted function is
 * how this gets written by hand already. Same launcher, same path
 * resolution, same guardrails: this reuses `CodeLink`'s cache and its
 * `open_in_editor`/`resolve_code_links` backend commands rather than
 * building a second copy of either.
 *
 * A widget decoration, not a node attribute — nothing new is stored in the
 * document. The path lives in the block's own text, so it already survives
 * save/reload and reads fine in any other Markdown viewer as an ordinary
 * comment line.
 *
 * DoD: the button never appears unless the path resolves — there is no
 * disabled/dead state here, unlike the inline link's "missing" styling.
 */

const codeBlockLinkKey = new PluginKey('codeBlockOpenInIde')

function firstLineSourcePath(node: { textContent: string }) {
  const firstLine = node.textContent.split('\n', 1)[0] ?? ''
  return codeBlockSourcePath(firstLine)
}

function decorate(state: EditorState, workspace: string | null): DecorationSet {
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
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'code-block-open-in-ide'
          button.contentEditable = 'false'
          button.title = `Open ${link.target} in the configured editor`
          button.textContent = `Open ${link.target}`
          button.setAttribute('data-target', link.target)
          button.setAttribute('data-line', String(link.line ?? ''))
          return button
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

export const CodeBlockOpenInIde = Extension.create({
  name: 'codeBlockOpenInIde',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeBlockLinkKey,
        state: {
          init: (_, state) => decorate(state, useWorkspaceStore.getState().path),
          apply: (tr, old, _oldState, newState) =>
            tr.docChanged || tr.getMeta(codeBlockLinkKey)
              ? decorate(newState, useWorkspaceStore.getState().path)
              : old,
        },
        view(view) {
          const onClick = (event: MouseEvent) => {
            const el = (event.target as HTMLElement | null)?.closest?.('.code-block-open-in-ide')
            if (!(el instanceof HTMLElement)) return
            event.preventDefault()

            const workspace = useWorkspaceStore.getState().path
            const target = el.getAttribute('data-target')
            if (!workspace || !target) return

            const rawLine = el.getAttribute('data-line')
            void api.notes.openInEditor(workspace, target, rawLine ? Number(rawLine) : null)
          }
          view.dom.addEventListener('click', onClick)

          const redraw = () => view.dispatch(view.state.tr.setMeta(codeBlockLinkKey, true))
          const ask = () => {
            const workspace = useWorkspaceStore.getState().path
            if (!workspace) return
            void resolveMissing(workspace, collectTargets(view.state), redraw)
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
