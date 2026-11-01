function toNumber(part: unknown): number | null {
  if (typeof part === 'number') return Number.isFinite(part) ? part : null
  if (typeof part === 'string' && part.trim() !== '') {
    const n = Number(part)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** `[lat, lng]` or `"lat,lng"` as a map position; null when it is not a real place. */
export function readCoords(value: unknown): [number, number] | null {
  const parts = typeof value === 'string' ? value.split(',') : value
  if (!Array.isArray(parts) || parts.length !== 2) return null
  const lat = toNumber(parts[0])
  const lng = toNumber(parts[1])
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return [lat, lng]
}
