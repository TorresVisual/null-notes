import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { readCoords } from '../../lib/mapCoords'
import { useSettingsStore } from '../../store/settings'
import type { LayoutProps } from './layoutProps'

const OSM_ATTRIBUTION = '© OpenStreetMap contributors'

// Leaflet is not unit-tested (jsdom has no layout); it is checked in the e2e run.
export function MapView({ result, view, onOpen }: LayoutProps) {
  const tileUrl = useSettingsStore((s) => s.settings.mapTileUrl)
  const container = useRef<HTMLDivElement>(null)
  const [tilesFailed, setTilesFailed] = useState(false)
  const property = typeof view.coordinates === 'string' ? view.coordinates : null

  const pins = useMemo(() => {
    if (!property) return []
    return result.groups
      .flatMap((g) => g.rows)
      .flatMap((row) => {
        const at = readCoords(result.cell(row, property))
        return at ? [{ row, at }] : []
      })
  }, [result, property])

  useEffect(() => {
    const element = container.current
    if (!element) return
    setTilesFailed(false)
    const map = L.map(element)
    const attribution = tileUrl.includes('openstreetmap.org') ? OSM_ATTRIBUTION : 'Map tiles'
    L.tileLayer(tileUrl, { attribution, maxZoom: 19 })
      .on('tileerror', () => setTilesFailed(true))
      .addTo(map)
    for (const { row, at } of pins) {
      L.marker(at, { icon: L.divIcon({ className: 'base-map-pin', iconSize: [14, 14] }), title: row.title })
        .on('click', () => onOpen(row.path))
        .bindTooltip(row.title)
        .addTo(map)
    }
    if (pins.length > 0) map.fitBounds(L.latLngBounds(pins.map((p) => p.at)), { padding: [30, 30], maxZoom: 14 })
    else map.setView([20, 0], 2)
    return () => {
      map.remove()
    }
  }, [tileUrl, pins, onOpen])

  if (!property) return <p className="base-empty">Choose a “Coordinates” property to place notes on the map.</p>

  return (
    <div className="base-map-wrap">
      {tilesFailed && <p className="base-banner" role="status">Couldn&apos;t load map tiles. Pins are shown without a map.</p>}
      {pins.length === 0 && <p className="base-banner" role="status">No note has a valid latitude and longitude in “{property}”.</p>}
      <div ref={container} className="base-map" />
    </div>
  )
}
