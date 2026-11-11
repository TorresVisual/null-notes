export function setDragChip(e: React.DragEvent, label: string, count: number): void {
  const chip = document.createElement('div')
  chip.className = 'drag-chip'
  const text = document.createElement('span')
  text.textContent = label
  chip.append(text)
  if (count > 1) {
    const badge = document.createElement('span')
    badge.className = 'drag-chip-count'
    badge.textContent = String(count)
    chip.append(badge)
  }
  document.body.append(chip)
  e.dataTransfer.setDragImage(chip, 12, 14)
  setTimeout(() => chip.remove(), 0)
}
