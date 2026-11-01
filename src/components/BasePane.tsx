import { lazy, Suspense, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useBase } from '../hooks/useBase'
import { useBaseRows } from '../hooks/useBaseRows'
import { usePropertyWrite } from '../hooks/usePropertyWrite'
import { refreshTree } from '../hooks/useWorkspace'
import { createDefaults } from '../lib/baseDefaults'
import { runView } from '../lib/baseQuery'
import { workspaceFilePath } from '../lib/canvasPath'
import { api } from '../lib/tauri'
import { promptText } from '../store/promptDialog'
import { useBaseRowsStore } from '../store/baseRows'
import { showToast } from '../store/toast'
import { useWorkspaceStore } from '../store/workspace'
import { ConflictBar } from './ConflictBar'
import { BaseSource } from './base/BaseSource'
import { BaseToolbar } from './base/BaseToolbar'
import { CardsView } from './base/CardsView'
import { KanbanView } from './base/KanbanView'
import { ListView } from './base/ListView'
import { TableView } from './base/TableView'

// Leaflet and its stylesheet only load when a map view is shown.
const MapView = lazy(() => import('./base/MapView').then((m) => ({ default: m.MapView })))

interface BasePaneProps {
  path: string
  embedded?: boolean
  /** The note embedding this base: what `this` means in its filters. */
  thisPath?: string
}

const SAVE_LABELS = { clean: '', dirty: 'Unsaved…', saving: 'Saving…', error: 'Save failed' } as const

// Mount with key={path}: useBase is bound to one file for its lifetime.
export function BasePane({ path, embedded = false, thisPath }: BasePaneProps) {
  const { base, error, saveState, conflict, update, keepMine, reloadTheirs, source, setSource } = useBase(path)
  const rows = useBaseRows()
  const write = usePropertyWrite()
  const workspace = useWorkspaceStore((s) => s.path)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const [selected, setSelected] = useState(0)
  const [sourceOpen, setSourceOpen] = useState(false)

  const viewIndex = base ? Math.min(selected, Math.max(base.views.length - 1, 0)) : 0
  const view = base?.views[viewIndex]
  const thisRow = thisPath ? (rows.find((r) => r.path === thisPath) ?? null) : null
  const result = useMemo(
    () => (base && view ? runView(base, viewIndex, rows, thisRow, { root: workspace ?? '' }) : null),
    [base, view, viewIndex, rows, thisRow, workspace],
  )

  const create = async (extra: Record<string, unknown>) => {
    if (!base || !view || !workspace) return
    const defaults = createDefaults(base, view)
    const title = await promptText('Note title:')
    if (!title) return
    const folder = defaults.folder ? workspaceFilePath(workspace, defaults.folder) : path.replace(/[\\/][^\\/]*$/, '')
    try {
      const note = await api.properties.createNote(workspace, folder, title, { ...defaults.properties, ...extra })
      await refreshTree()
      await useBaseRowsStore.getState().reload()
      openTab(note.path)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e))
    }
  }

  const layoutProps =
    view && result
      ? { result, rows, view, onWrite: (r: typeof rows[number], k: string, v: unknown) => void write(r, k, v), onCreate: (p: Record<string, unknown>) => void create(p), onOpen: openTab }
      : null

  return (
    <div className={`base-pane${embedded ? ' base-pane--embedded' : ''}`}>
      {error && (
        <div className="conflict-bar" role="alert">
          <AlertTriangle size={14} />
          <span>{error} The base is not saved while this is wrong, so the file is never overwritten.</span>
        </div>
      )}
      {conflict && (
        <ConflictBar
          message="This base changed on disk while you were editing it."
          onKeepMine={keepMine}
          onReloadTheirs={reloadTheirs}
        />
      )}
      {base && (
        <BaseToolbar
          base={base}
          rows={rows}
          result={result}
          viewIndex={viewIndex}
          saveLabel={SAVE_LABELS[saveState]}
          sourceOpen={sourceOpen}
          onSelectView={setSelected}
          onEdit={update}
          onToggleSource={() => setSourceOpen(!sourceOpen)}
          onCreate={() => void create({})}
        />
      )}
      {result && (result.errors.length > 0 || result.unsupported.length > 0) && (
        <div className="base-banner" role="status">
          {result.unsupported.length > 0 && <p>Unsupported: {result.unsupported.join(', ')}. Rows are shown without it.</p>}
          {result.errors.map((message) => <p key={message}>{message}</p>)}
        </div>
      )}
      {(sourceOpen || !base) && source !== '' && <BaseSource source={source} onChange={setSource} />}
      {layoutProps && view?.type === 'table' && <TableView {...layoutProps} />}
      {layoutProps && view?.type === 'list' && <ListView {...layoutProps} />}
      {layoutProps && view?.type === 'cards' && <CardsView {...layoutProps} />}
      {layoutProps && view?.type === 'kanban' && <KanbanView {...layoutProps} />}
      {layoutProps && view?.type === 'map' && (
        <Suspense fallback={null}>
          <MapView {...layoutProps} />
        </Suspense>
      )}
      {layoutProps && view && !['table', 'list', 'cards', 'kanban', 'map'].includes(view.type) && (
        <p className="base-empty">The {view.type} layout isn’t available yet.</p>
      )}
    </div>
  )
}
