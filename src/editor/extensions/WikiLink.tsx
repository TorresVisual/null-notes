import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { createPortal } from 'react-dom'
import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, ReactRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { useNotesStore } from '../../store/notes'
import { useWorkspaceStore } from '../../store/workspace'
import { useCreateNote } from '../../hooks/useCreateNote'
import { excerptForPreview } from '../../lib/notePreview'
import { api } from '../../lib/tauri'
import { encodeAttr } from '../../lib/htmlAttr'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'

interface WikiLinkAttrs {
  title: string
}

function WikiLinkView({ node }: ReactNodeViewProps) {
  const { title } = node.attrs as unknown as WikiLinkAttrs
  const notes = useNotesStore((s) => s.notes)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const createNote = useCreateNote()
  // "Go to definition" without clicking through: a short excerpt of the
  // target note's own content, fetched lazily on hover rather than for
  // every link on mount — most links on screen are never hovered.
  const [preview, setPreview] = useState<string | null>(null)

  const target = notes.find((n) => n.title.toLowerCase() === title.toLowerCase())

  // Creating the missing note is what resolves the link: the new note lands in
  // the store, this view re-renders, and `target` is found on the next pass.
  function handleClick() {
    if (target) {
      openTab(target.path)
      return
    }
    void createNote(title)
  }

  const link = (
    <NodeViewWrapper
      as="span"
      className={`wiki-link${target ? '' : ' wiki-link-missing'}`}
      onClick={handleClick}
      title={target ? undefined : `Create note "${title}"`}
      spellCheck={false}
    >
      {title}
    </NodeViewWrapper>
  )

  if (!target) {
    return link
  }

  function handleOpenChange(open: boolean) {
    // TS doesn't carry the outer `if (!target) return`'s narrowing into a
    // nested function's body (a closure could in principle run after
    // control flow no longer guarantees it), so it's re-checked here even
    // though this branch is unreachable with target undefined at runtime.
    if (!open || !target || preview !== null) return
    void api.notes
      .open(target.workspace, target.path)
      .then((content) => setPreview(excerptForPreview(content)))
  }

  return (
    <Tooltip onOpenChange={handleOpenChange}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent className="wiki-link-preview">{preview || target.path}</TooltipContent>
    </Tooltip>
  )
}

// ── [[ autocomplete ──────────────────────────────────────────────────────────
// Mirrors SlashCommands.tsx's Suggestion setup — same rect-anchored portal
// menu, same keyboard handling, same `.slash-menu` classes reused rather than
// duplicated. Only the item source differs: note titles instead of a fixed
// command list, plus a trailing "create note" entry for titles that don't
// exist yet, since a wiki-link is allowed to point at a note that isn't
// written yet.
interface WikiLinkItem {
  title: string
  isNew: boolean
}

function wikiLinkItems({ query }: { query: string }): WikiLinkItem[] {
  const q = query.toLowerCase()
  const notes = useNotesStore.getState().notes
  const matches = notes
    .filter((n) => n.title.toLowerCase().includes(q))
    .slice(0, 10)
    .map((n) => ({ title: n.title, isNew: false }))
  const exact = notes.some((n) => n.title.toLowerCase() === q)
  if (query && !exact) matches.push({ title: query, isNew: true })
  return matches
}

interface WikiLinkMenuProps {
  items: WikiLinkItem[]
  onSelect: (item: WikiLinkItem) => void
  clientRect: (() => DOMRect | null) | null
}

interface WikiLinkMenuHandle {
  onKeyDown: (e: KeyboardEvent) => boolean
}

const WikiLinkMenu = forwardRef<WikiLinkMenuHandle, WikiLinkMenuProps>(function WikiLinkMenu(
  { items, onSelect, clientRect },
  ref,
) {
  const [selected, setSelected] = useState(0)

  useEffect(() => setSelected(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown(e) {
      if (e.key === 'ArrowUp') {
        setSelected((s) => Math.max(0, s - 1))
        return true
      }
      if (e.key === 'ArrowDown') {
        setSelected((s) => Math.min(items.length - 1, s + 1))
        return true
      }
      if (e.key === 'Enter') {
        const item = items[selected]
        if (item) onSelect(item)
        return true
      }
      return false
    },
  }))

  const rect = clientRect?.()
  if (!items.length || !rect) return null

  return createPortal(
    <div
      className="slash-menu"
      style={{ position: 'fixed', top: rect.bottom + 6, left: rect.left, zIndex: 50 }}
    >
      {items.map((item, i) => (
        <button
          key={item.title}
          className={`slash-menu-item${i === selected ? ' selected' : ''}`}
          onMouseEnter={() => setSelected(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(item)
          }}
        >
          <span className="slash-item-title">{item.isNew ? `Create note "${item.title}"` : item.title}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
})

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('wikiLinkSuggestion'),
        char: '[[',
        allowSpaces: true,
        startOfLine: false,
        items: wikiLinkItems,
        command({ editor, range, props }) {
          const { title } = props as WikiLinkItem
          editor.chain().focus().deleteRange(range).insertContent({ type: 'wikiLink', attrs: { title } }).run()
        },
        render() {
          let renderer: ReactRenderer<WikiLinkMenuHandle, WikiLinkMenuProps>

          return {
            onStart(props) {
              renderer = new ReactRenderer(WikiLinkMenu, {
                props: {
                  items: props.items as WikiLinkItem[],
                  onSelect: (item: WikiLinkItem) => props.command(item),
                  clientRect: props.clientRect,
                },
                editor: props.editor,
              })
            },
            onUpdate(props) {
              renderer.updateProps({
                items: props.items as WikiLinkItem[],
                onSelect: (item: WikiLinkItem) => props.command(item),
                clientRect: props.clientRect,
              })
            },
            onKeyDown({ event }) {
              if (event.key === 'Escape') {
                renderer.destroy()
                return true
              }
              return renderer.ref?.onKeyDown(event) ?? false
            },
            onExit() {
              renderer.destroy()
            },
          }
        },
      }),
    ]
  },

  addAttributes() {
    return {
      title: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="wiki-link"]',
        getAttrs: (el) => ({
          title: (el as HTMLElement).getAttribute('data-title') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-type': 'wiki-link' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(WikiLinkView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: Record<string, unknown>, node: { attrs: WikiLinkAttrs }) {
          ;(state as { write: (s: string) => void }).write(`[[${node.attrs.title}]]`)
        },
        parse: {
          setup(markdownit: {
            core: { ruler: { push: (name: string, fn: (state: unknown) => void) => void } }
          }) {
            markdownit.core.ruler.push('wiki_link', (state: unknown) => {
              const st = state as {
                tokens: Array<{
                  type: string
                  children: Array<{ type: string; content: string }> | null
                }>
              }
              for (const token of st.tokens) {
                if (token.type !== 'inline' || !token.children) continue
                const newChildren: typeof token.children = []
                for (const child of token.children) {
                  if (child.type !== 'text') {
                    newChildren.push(child)
                    continue
                  }
                  const parts = child.content.split(/\[\[([^\]\n]+)\]\]/)
                  if (parts.length === 1) {
                    newChildren.push(child)
                    continue
                  }
                  for (let i = 0; i < parts.length; i++) {
                    const part = parts[i] ?? ''
                    if (i % 2 === 0) {
                      if (part) newChildren.push({ type: 'text', content: part })
                    } else {
                      newChildren.push({
                        type: 'html_inline',
                        content: `<span data-type="wiki-link" data-title="${encodeAttr(part)}"></span>`,
                      })
                    }
                  }
                }
                token.children = newChildren
              }
            })
          },
        },
      },
    }
  },
})

