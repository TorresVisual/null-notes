import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'

export function TagList() {
  const tags = useNotesStore((s) => s.tags)
  const tagFilter = useWorkspaceStore((s) => s.tagFilter)
  const setTagFilter = useWorkspaceStore((s) => s.setTagFilter)

  if (tags.length === 0) return null

  return (
    <ul className="tag-list">
      {tags.map((tag) => {
        const isActive = tagFilter?.toLowerCase() === tag.toLowerCase()
        return (
          <li key={tag}>
            <button
              className={`tag-item${isActive ? ' active' : ''}`}
              onClick={() => setTagFilter(isActive ? null : tag)}
            >
              #{tag}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
