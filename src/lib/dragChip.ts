export function setDragChip(e: React.DragEvent, label: string, count: number): void {
  const chip = document.createElement('div')
  chip.className = 'drag-chip'
  chip.textContent = count > 1 ? `${label} +${count - 1}` : label
  document.body.append(chip)
  e.dataTransfer.setDragImage(chip, 0, 12)
  setTimeout(() => chip.remove(), 0)
}
