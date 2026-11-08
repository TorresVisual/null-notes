import { Fragment, useRef } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { EditorGroupPane, type GroupSharedProps } from './EditorGroupPane'
import { SplitDivider } from './SplitDivider'

export function EditorGroups(shared: GroupSharedProps) {
  const groupCount = useWorkspaceStore((s) => s.layout.groups.length)
  const direction = useWorkspaceStore((s) => s.layout.direction)
  const ratio = useWorkspaceStore((s) => s.layout.ratio)
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div className={`editor-groups editor-groups--${direction}`} ref={containerRef}>
      {Array.from({ length: groupCount }, (_, i) => (
        <Fragment key={i}>
          {i === 1 && <SplitDivider direction={direction} ratio={ratio} containerRef={containerRef} />}
          <EditorGroupPane group={i} shared={shared} />
        </Fragment>
      ))}
    </div>
  )
}
