import { InputRule } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { Link } from '@tiptap/extension-link'
import type { LinkOptions } from '@tiptap/extension-link'
import { applyMarkdownLink } from '../../lib/markdownLink'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  isBareNoteName,
  isExternalHref,
  isSafeExternalHref,
  relativeNoteLink,
  resolveNoteLink,
} from '../../lib/noteLinks'
import { useNotesStore } from '../../store/notes'
import { useWorkspaceStore } from '../../store/workspace'
import { noteMenuRender } from './WikiLink'
import type { WikiLinkItem } from './WikiLink'

// Typing `[text](target)` makes a link, as in any Markdown editor.
const MARKDOWN_LINK = /(?<!!)\[([^\]\n]+)\]\(([^)\n]+)\)$/
// Typing `Name.md ` links only when that note exists next to this one.
const NOTE_NAME_THEN_SPACE = /(?:^|\s)([^\s[\]()<>]+\.md) $/i

interface NoteLinkItem extends WikiLinkItem {
  path: string
}

// The `[text` a `](` is closing, so the menu only opens inside link syntax.
const OPEN_LABEL = /\[([^\]\n]+)$/

function labelBefore(doc: ProseMirrorNode, pos: number): string {
  return doc.textBetween(doc.resolve(pos).start(), pos, '\n', '￼')
}

function nextChar(doc: ProseMirrorNode, pos: number): string {
  return doc.textBetween(pos, Math.min(pos + 1, doc.content.size), '\n', '￼')
}

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
        handler: ({ state, range }) => (applyMarkdownLink(state.tr, type, range.to, 0) ? undefined : null),
      }),
      new InputRule({
        find: NOTE_NAME_THEN_SPACE,
        handler: ({ state, range, match }) => {
          const name = match[1] ?? ''
          const workspace = useWorkspaceStore.getState().path
          const paths = useNotesStore.getState().notes.map((n) => n.path)
          if (!workspace || !resolveNoteLink(name, notePath(), workspace, paths)) return null

          const nameEnd = range.to - 1
          state.tr.addMark(nameEnd - name.length, nameEnd, type.create({ href: name }))
          return undefined
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    const notePath = () => this.editor.storage.noteContext.notePath as string

    return [
      ...(this.parent?.() ?? []),
      Suggestion<NoteLinkItem>({
        editor: this.editor,
        pluginKey: new PluginKey('noteLinkSuggestion'),
        char: '](',
        allowSpaces: true,
        allowedPrefixes: null,
        allow: ({ state, range }) => OPEN_LABEL.test(labelBefore(state.doc, range.from)),
        items: ({ query }) => {
          const q = query.toLowerCase()
          return useNotesStore
            .getState()
            .notes.filter((n) => n.path !== notePath() && n.title.toLowerCase().includes(q))
            .slice(0, 10)
            .map((n) => ({ title: n.title, isNew: false, path: n.path }))
        },
        command: ({ editor, range, props }) => {
          const label = OPEN_LABEL.exec(labelBefore(editor.state.doc, range.from))
          if (!label) return
          editor
            .chain()
            .focus()
            .insertContentAt(
              { from: range.from - label[0].length, to: range.to + (nextChar(editor.state.doc, range.to) === ')' ? 1 : 0) },
              {
                type: 'text',
                text: label[1],
                marks: [{ type: 'link', attrs: { href: relativeNoteLink(notePath(), props.path) } }],
              },
            )
            .command(({ tr }) => {
              tr.setStoredMarks([])
              return true
            })
            .run()
        },
        render: noteMenuRender,
      }),
      new Plugin({
        key: new PluginKey('noteLinkClick'),
        props: {
          // Keeps the caret off the link, so the line stays collapsed and the
          // click that follows opens it.
          handleDOMEvents: {
            mousedown: (_view, event) => {
              if (event.button !== 0 || !(event.target as HTMLElement | null)?.closest?.('a[href]')) return false
              event.preventDefault()
              return true
            },
          },
        },
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
