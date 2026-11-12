import { Fragment } from 'react'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useSettingsStore } from '../../store/settings'
import { isWidget, resolveToolbarItems } from './toolbarItems'

interface MobileToolbarItemsProps {
  editor: Editor
  notePath: string
}

// Same reason as TextFormatGroup: toggling a mark leaves the selection where it
// was, so the pressed/disabled state has to follow the editor's own transactions.
// The colour attributes ride along so the colour widgets re-render when they change.
export function MobileToolbarItems({ editor, notePath }: MobileToolbarItemsProps) {
  const saved = useSettingsStore((s) => s.settings.mobileToolbar)
  const items = resolveToolbarItems(saved)
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      active: items.filter((i) => !isWidget(i) && i.isActive?.(editor)).map((i) => i.id),
      disabled: items.filter((i) => !isWidget(i) && i.isDisabled?.(editor)).map((i) => i.id),
      color: editor.getAttributes('spanStyle')['color'] as unknown,
      background: editor.getAttributes('spanStyle')['backgroundColor'] as unknown,
    }),
  })

  return (
    <div className="toolbar-group" role="group" aria-label="Formatting and insert">
      {items.map((item) => {
        if (isWidget(item)) return <Fragment key={item.id}>{item.widget(editor)}</Fragment>
        const active = state.active.includes(item.id)
        return (
          <button
            key={item.id}
            className={`toolbar-button${active ? ' active' : ''}`}
            aria-pressed={item.isActive ? active : undefined}
            aria-label={item.label}
            title={item.label}
            disabled={state.disabled.includes(item.id)}
            onClick={() => item.run({ editor, notePath })}
          >
            <item.icon size={15} />
          </button>
        )
      })}
    </div>
  )
}
