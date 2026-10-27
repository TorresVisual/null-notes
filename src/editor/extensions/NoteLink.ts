import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Link } from '@tiptap/extension-link'
import type { LinkOptions } from '@tiptap/extension-link'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isBareNoteName, isExternalHref, resolveNoteLink } from '../../lib/noteLinks'
import { useNotesStore } from '../../store/notes'
import { useWorkspaceStore } from '../../store/workspace'

export const NoteLink = Link.extend({
  addOptions() {
    const parent = this.parent?.() as LinkOptions
    return {
      ...parent,
      shouldAutoLink: (url: string) => !isBareNoteName(url) && parent.shouldAutoLink(url),
    }
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
              void openUrl(href)
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
