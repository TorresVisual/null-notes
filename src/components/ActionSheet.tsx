import { useActionSheetStore } from '../store/actionSheet'

export function ActionSheet() {
  const sheet = useActionSheetStore((s) => s.sheet)
  const close = useActionSheetStore((s) => s.close)
  if (!sheet) return null

  return (
    <>
      <div className="mobile-sheet-backdrop" onClick={close} />
      <div className="mobile-sheet" role="dialog" aria-label={sheet.title}>
        <div className="mobile-sheet-title">{sheet.title}</div>
        {sheet.actions.map(({ label, icon: Icon, onSelect, destructive }) => (
          <button
            key={label}
            className={`mobile-sheet-action${destructive ? ' is-danger' : ''}`}
            onClick={() => {
              close()
              onSelect()
            }}
          >
            <Icon size={18} /> {label}
          </button>
        ))}
      </div>
    </>
  )
}
