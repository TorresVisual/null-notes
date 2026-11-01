import { toStr } from '../../lib/baseValue'
import type { BaseRow } from '../../types'
import type { LayoutProps } from './layoutProps'

const WEB_URL = /^https?:\/\//
const HEX_COLOUR = /^#[0-9a-f]{3,8}$/i

export function CardsView({ result, view, onOpen }: LayoutProps) {
  const size = typeof view.cardSize === 'number' ? view.cardSize : 240
  const imageProperty = typeof view.image === 'string' ? view.image : null
  const fit = view.imageFit === 'contain' ? 'contain' : 'cover'
  const ratio = typeof view.imageAspectRatio === 'number' && view.imageAspectRatio > 0 ? view.imageAspectRatio : 1
  const meta = result.columns.filter((c) => c.id !== 'file.name')
  const grouped = Boolean(view.groupBy)
  if (result.groups.every((g) => g.rows.length === 0) && !grouped) {
    return <p className="base-empty">No notes match this view.</p>
  }

  const cover = (row: BaseRow) => {
    const value = imageProperty ? toStr(result.cell(row, imageProperty)) : ''
    const box = { aspectRatio: `1 / ${ratio}` }
    if (WEB_URL.test(value)) {
      return <img className="base-card-image" style={{ ...box, objectFit: fit }} src={value} alt="" loading="lazy" />
    }
    if (HEX_COLOUR.test(value)) return <div className="base-card-image" style={{ ...box, background: value }} />
    return null
  }

  return (
    <div className="base-cards-wrap">
      {result.groups.map((group) => (
        <section key={group.label}>
          {grouped && <h3 className="base-group-title">{group.label}</h3>}
          <div className="base-cards" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
            {group.rows.map((row) => (
              <article key={row.path} className="base-card">
                {cover(row)}
                <button className="base-link" onClick={() => onOpen(row.path)}>{row.title}</button>
                <dl className="base-card-fields">
                  {meta.map((c) => {
                    const text = toStr(result.cell(row, c.id))
                    return text ? (
                      <div key={c.id}>
                        <dt>{c.label}</dt>
                        <dd>{text}</dd>
                      </div>
                    ) : null
                  })}
                </dl>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
