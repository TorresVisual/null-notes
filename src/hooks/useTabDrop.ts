import { useEffect, useState, type DragEvent, type RefObject } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { dropZoneAt, TAB_DRAG_MIME, type DropZone } from '../lib/dropZone'
import { isBasePath, isCanvasPath } from '../lib/canvasPath'

const isTabDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(TAB_DRAG_MIME)

function dropTab(path: string, zone: DropZone, group: number, copy: boolean) {
  const store = useWorkspaceStore.getState()
  if (zone !== 'center') {
    if (isCanvasPath(path) || isBasePath(path)) return
    if (!store.layout.groups.some((g) => g.tabs.includes(path))) store.openTab(path)
    store.splitEditor(zone, path)
    return
  }
  const { groups } = store.layout
  if (groups[group]?.tabs.includes(path)) store.activateTabIn(path, group)
  else if (groups.some((g) => g.tabs.includes(path))) store.moveTabToGroup(path, group, copy)
  else {
    store.focusGroup(group)
    store.openTab(path)
  }
}

// `bodyRef` is the editor body: the tab strip above it is never an edge.
export function useTabDrop(group: number, bodyRef: RefObject<HTMLElement | null>) {
  const [zone, setZone] = useState<DropZone | null>(null)

  useEffect(() => {
    const clear = () => setZone(null)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  const zoneFor = (e: DragEvent): DropZone => {
    const rect = bodyRef.current?.getBoundingClientRect()
    if (!rect || e.clientY < rect.top) return 'center'
    return dropZoneAt(rect, e.clientX, e.clientY, useWorkspaceStore.getState().layout.groups.length)
  }

  return {
    zone,
    dropProps: {
      onDragOver: (e: DragEvent) => {
        if (!isTabDrag(e)) return
        e.preventDefault()
        setZone(zoneFor(e))
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setZone(null)
      },
      onDrop: (e: DragEvent) => {
        if (!isTabDrag(e)) return
        const path = e.dataTransfer.getData(TAB_DRAG_MIME) || e.dataTransfer.getData('text/plain')
        const target = zoneFor(e)
        setZone(null)
        if (!path) return
        e.preventDefault()
        dropTab(path, target, group, e.ctrlKey)
      },
    },
  }
}
