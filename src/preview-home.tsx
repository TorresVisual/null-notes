import { createRoot } from 'react-dom/client'
import './index.css'
import { HomeView } from './components/HomeView'
import { useWorkspaceStore } from './store/workspace'
import { useNotesStore } from './store/notes'
import { api } from './lib/tauri'

const now = Date.now()
const mk = (t: string, ago: number) => ({ id: t, title: t, path: `/ws/${t}.md`, workspace: '/ws', updatedAt: now - ago })
useNotesStore.setState({ notes: [mk('Graph Theory', 34 * 60e3), mk('Lecture 7', 2 * 3600e3), mk('Proofs', 3 * 3600e3), mk('Link', 4 * 86400e3)], folders: [], tags: [] })
useWorkspaceStore.setState({ path: '/ws', openTabs: ['/ws/Lecture 7.md', '/ws/Graph Theory.md'], repoMode: new URLSearchParams(location.search).has('git') ? 'notesOnly' : null })
const full = new URLSearchParams(location.search).has('full')
api.notes.listOpenTasks = async () => (full ? [{ notePath: '/ws/Proofs.md', noteTitle: 'Proofs', text: 'Finish induction proof', position: 0 }, { notePath: '/ws/Lecture 7.md', noteTitle: 'L', text: 'Review the master theorem examples before Thursday', position: 1 }] : [])
api.notes.listDueCards = async () => (full ? [{ notePath: '/ws/a.md', noteTitle: 'A', kind: 'qa', front: 'Q', back: 'A', position: 0, options: [], streak: 0 }] as never : [])
createRoot(document.getElementById('root')!).render(<div style={{ padding: 24 }}><HomeView onOpenTaskView={() => {}} onOpenReview={() => {}} onOpenDeckView={() => {}} onOpenSettings={() => {}} /></div>)
