import { InputRule } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Link } from '@tiptap/extension-link'
import type { LinkOptions } from '@tiptap/extension-link'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isBareNoteName, isExternalHref, isSafeExternalHref, resolveNoteLink } from '../../lib/noteLinks'
import { useNotesStore } from '../../store/notes'
import { useWorkspaceStore } from '../../store/workspace'

// Typing `[text](target)` makes a link, as in any Markdown editor.
const MARKDOWN_LINK = /(?<!!)\[([^\]\n]+)\]\(([^)\n]+)\)$/
// Typing `Name.md ` links only when that note exists next to this one.
const NOTE_NAME_THEN_SPACE = /(?:^|\s)([^\s[\]()<>]+\.md) $/i

export const NoteLink = Link.extend({
  addOptions() {
    const parent = this.parent?.() as LinkOptions
    return {
      ...parent,
      shouldAutoLink: (url: string) => !isBareNoteName(url) && parent.shouldAutoLink(url),
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: '[',
          // A space ends a Markdown link destination, so it is escaped here at
          // the boundary; `%20` is left alone, which keeps this idempotent.
          close: (_state: unknown, mark: { attrs: { href: string; title?: string | null } }) => {
            const href = mark.attrs.href.replace(/ /g, '%20').replace(/[()]/g, '\\$&')
            const title = mark.attrs.title ? ` "${mark.attrs.title.replace(/"/g, '\\"')}"` : ''
            return `](${href}${title})`
          },
          mixable: true,
        },
        parse: {},
      },
    }
  },

  addInputRules() {
    const type = this.type
    const notePath = () => this.editor.storage.noteContext.notePath as string

    return [
      new InputRule({
        find: MARKDOWN_LINK,
        handler: ({ state, range, match }) => {
          const [, text = '', href = ''] = match
          state.tr
            .replaceWith(range.from, range.to, state.schema.text(text, [type.create({ href: href.trim() })]))
            .setStoredMarks([])
        },
      }),
      new InputRule({
        find: NOTE_NAME_THEN_SPACE,
        handler: ({ state, range, match }) => {
          const name = match[1] ?? ''
          const workspace = useWorkspaceStore.getState().path
          const paths = useNotesStore.getState().notes.map((n) => n.path)
          if (!workspace || !resolveNoteLink(name, notePath(), workspace, paths)) return null

          state.tr
            .insertText(' ', range.to)
            .addMark(range.to - name.length, range.to, type.create({ href: name }))
          return undefined
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    const notePath = () => this.editor.storage.noteContext.notePath as string

    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey('noteLinkClick'),
        view: (view) => {
          const onClick = (event: MouseEvent) => {
            const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]')
            if (!anchor || event.button !== 0) return
            const href = anchor.getAttribute('href') ?? ''
            event.preventDefault()

            if (isExternalHref(href)) {
              if (isSafeExternalHref(href)) void openUrl(href)
              return
            }

            const workspace = useWorkspaceStore.getState().path
            if (!workspace) return
            const paths = useNotesStore.getState().notes.map((n) => n.path)
            const target = resolveNoteLink(href, notePath(), workspace, paths)
            if (target) useWorkspaceStore.getState().openTab(target)
          }
          view.dom.addEventListener('click', onClick)
          return { destroy: () => view.dom.removeEventListener('click', onClick) }
        },
      }),
    ]
  },
})
