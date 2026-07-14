import { TreeNode } from './TreeNode'
import type { TreeEntry } from '../lib/folderTree'

interface FolderTreeProps {
  entries: TreeEntry[]
  depth?: number
}

export function FolderTree({ entries, depth = 0 }: FolderTreeProps) {
  return (
    <ul className="folder-tree">
      {entries.map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={depth} />
      ))}
    </ul>
  )
}
