import { useMemo } from 'react'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'

const SECTION_CAP = 5

function tabLabel(path: string): string {
  return path.split(/[\\/]/).pop()?.replace('.md', '') ?? path
}

interface HomeViewProps {
  onOpenTaskView: () => void
}

export function HomeView({ onOpenTaskView }: HomeViewProps) {
  const openTabs = useWorkspaceStore((s) => s.openTabs)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const notes = useNotesStore((s) => s.notes)

  const continueItems = useMemo(
    () => [...openTabs].reverse().slice(0, SECTION_CAP),
    [openTabs],
  )
  const recentItems = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SECTION_CAP),
    [notes],
  )

  return (
    <div className="home-view">
      <section className="home-section">
        <h2>Continue</h2>
        {continueItems.length === 0 ? (
          <p className="home-empty">No open notes.</p>
        ) : (
          <ul>
            {continueItems.map((path) => (
              <li key={path}>
                <button className="home-section-item" onClick={() => setActiveTab(path)}>
                  {tabLabel(path)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="home-section">
        <h2>Recent</h2>
        {recentItems.length === 0 ? (
          <p className="home-empty">No notes yet.</p>
        ) : (
          <ul>
            {recentItems.map((note) => (
              <li key={note.path}>
                <button className="home-section-item" onClick={() => openTab(note.path)}>
                  {note.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
