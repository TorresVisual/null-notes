import { ChevronRight } from 'lucide-react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'

export function TagList() {
  const tags = useNotesStore((s) => s.tags)
  const tagFilter = useWorkspaceStore((s) => s.tagFilter)
  const setTagFilter = useWorkspaceStore((s) => s.setTagFilter)
  const collapsed = useWorkspaceStore((s) => s.tagsCollapsed)
  const toggleTags = useWorkspaceStore((s) => s.toggleTags)

  if (tags.length === 0) return null

  return (
    <section className={`sidebar-tags${collapsed ? ' is-collapsed' : ''}`}>
      <button className="sidebar-section-toggle" onClick={toggleTags} aria-expanded={!collapsed}>
        <ChevronRight size={12} />
        <span>Tags</span>
        {collapsed && tagFilter && <span className="sidebar-section-hint">#{tagFilter}</span>}
      </button>
      {!collapsed && (
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
      )}
    </section>
  )
}
