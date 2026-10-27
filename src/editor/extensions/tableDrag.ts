import { gapIndex, gapToTarget } from './tableOps'

interface GripDrag {
  grip: HTMLElement
  axis: 'col' | 'row'
  index: number
  wrapper: HTMLElement
  controls: HTMLElement
  // Lowest gap a drop may land in; rows use 1 to stay below the header.
  minGap: number
  onDrop: (target: number) => void
}

const MOVE_THRESHOLD_PX = 4

function itemRects(wrapper: HTMLElement, axis: 'col' | 'row'): DOMRect[] {
  const selector = axis === 'col' ? ':scope > table > tbody > tr:first-child > *' : ':scope > table > tbody > tr'
  return Array.from(wrapper.querySelectorAll(selector)).map((el) => el.getBoundingClientRect())
}

function showDropLine(wrapper: HTMLElement, controls: HTMLElement, axis: 'col' | 'row', rects: DOMRect[], gap: number): void {
  controls.querySelector(':scope > .table-drop-line')?.remove()
  const first = rects[0]
  const last = rects[rects.length - 1]
  if (!first || !last) return
  const origin = wrapper.getBoundingClientRect()
  const line = document.createElement('div')
  line.className = 'table-drop-line'
  if (axis === 'col') {
    const edge = gap < rects.length ? (rects[gap] as DOMRect).left : last.right
    line.style.left = `${edge - origin.left - 1}px`
    line.style.top = `${first.top - origin.top}px`
    line.style.width = '2px'
    line.style.height = `${last.bottom - first.top}px`
  } else {
    const edge = gap < rects.length ? (rects[gap] as DOMRect).top : last.bottom
    line.style.top = `${edge - origin.top - 1}px`
    line.style.left = `${first.left - origin.left}px`
    line.style.height = '2px'
    line.style.width = `${first.width}px`
  }
  controls.appendChild(line)
}

// Pointer-driven reorder on the grip. A press that never travels past the
// threshold is left alone so the grip's menu still opens on click.
export function attachGripDrag({ grip, axis, index, wrapper, controls, minGap, onDrop }: GripDrag): void {
  grip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    const start = axis === 'col' ? event.clientX : event.clientY
    const rects = itemRects(wrapper, axis)
    const mids = rects.map((r) => (axis === 'col' ? r.left + r.width / 2 : r.top + r.height / 2))
    let dragging = false
    let gap = -1
    grip.setPointerCapture(event.pointerId)

    const onMove = (move: PointerEvent) => {
      const pointer = axis === 'col' ? move.clientX : move.clientY
      if (!dragging && Math.abs(pointer - start) < MOVE_THRESHOLD_PX) return
      dragging = true
      controls.classList.add('dragging')
      gap = gapIndex(mids, pointer, minGap)
      showDropLine(wrapper, controls, axis, rects, gap)
    }

    const finish = (up: PointerEvent) => {
      grip.removeEventListener('pointermove', onMove)
      grip.removeEventListener('pointerup', finish)
      grip.removeEventListener('pointercancel', finish)
      controls.classList.remove('dragging')
      controls.querySelector(':scope > .table-drop-line')?.remove()
      if (!dragging) return
      // The click that follows a drag would otherwise toggle the grip's menu.
      const swallow = (click: Event) => click.preventDefault()
      grip.addEventListener('click', swallow, { once: true, capture: true })
      setTimeout(() => grip.removeEventListener('click', swallow, true), 0)
      if (up.type === 'pointerup' && gap >= 0) {
        const target = gapToTarget(gap, index)
        if (target !== index) onDrop(target)
      }
    }

    grip.addEventListener('pointermove', onMove)
    grip.addEventListener('pointerup', finish)
    grip.addEventListener('pointercancel', finish)
  })
}
