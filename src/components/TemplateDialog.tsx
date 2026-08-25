import { useEffect, useState } from 'react'
import { FileText, X } from 'lucide-react'
import { api } from '../lib/tauri'
import { extractPlaceholders, fillTemplate } from '../lib/templatePlaceholders'
import { useCreateNoteFromTemplate } from '../hooks/useCreateNoteFromTemplate'
import { useWorkspaceStore } from '../store/workspace'
import { showToast } from '../store/toast'
import type { TemplateMetadata } from '../types'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface TemplateDialogProps {
  onClose: () => void
}

interface SelectedTemplate {
  meta: TemplateMetadata
  content: string
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Note title',
  date: 'Date',
}

function fieldLabel(name: string): string {
  return FIELD_LABELS[name] ?? name
}

export function TemplateDialog({ onClose }: TemplateDialogProps) {
  const workspacePath = useWorkspaceStore((s) => s.path)
  const createNoteFromTemplate = useCreateNoteFromTemplate()
  const [templates, setTemplates] = useState<TemplateMetadata[] | null>(null)
  const [selected, setSelected] = useState<SelectedTemplate | null>(null)
  const [fields, setFields] = useState<string[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspacePath) return
    void api.templates.list(workspacePath).then(setTemplates)
  }, [workspacePath])

  async function handleSeedDefaults() {
    if (!workspacePath) return
    await api.templates.seedDefaults(workspacePath)
    setTemplates(await api.templates.list(workspacePath))
  }

  async function handlePick(meta: TemplateMetadata) {
    const content = await api.templates.read(meta.path)
    const placeholderFields = extractPlaceholders(content).filter((name) => name !== 'title')
    const allFields = ['title', ...placeholderFields]
    const today = new Date().toISOString().slice(0, 10)
    setValues(Object.fromEntries(allFields.map((f) => [f, f === 'date' ? today : ''])))
    setFields(allFields)
    setSelected({ meta, content })
    setError(null)
  }

  async function handleCreate() {
    if (!selected) return
    const title = values.title?.trim()
    if (!title) {
      setError('Title is required.')
      return
    }
    const content = fillTemplate(selected.content, values)
    const meta = await createNoteFromTemplate(title, content)
    if (meta) {
      showToast(`Created "${meta.title}"`)
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="settings-panel" showCloseButton={false}>
        <div className="settings-panel-header">
          <DialogTitle asChild>
            <h2>{selected ? selected.meta.name : 'New from Template'}</h2>
          </DialogTitle>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </div>

        {!selected ? (
          <>
            {templates === null && <p className="template-empty-hint">Loading…</p>}
            {templates?.length === 0 && (
              <>
                <p className="template-empty-hint">
                  No templates yet — add <code>.md</code> files to this workspace's{' '}
                  <code>templates/</code> folder, or start with the exercise-sheet layout.
                </p>
                <button className="import-mode-option" onClick={() => void handleSeedDefaults()}>
                  <FileText size={18} />
                  <span>
                    <strong>Add the exercise-sheet starter template</strong>
                    <small>Task/Solution pairs, the same shape P4-3's Split Into Tasks produces.</small>
                  </span>
                </button>
              </>
            )}
            {templates && templates.length > 0 && (
              <div className="template-list">
                {templates.map((t) => (
                  <button
                    key={t.path}
                    className="import-mode-option"
                    onClick={() => void handlePick(t)}
                  >
                    <FileText size={18} />
                    <span>
                      <strong>{t.name}</strong>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {fields.map((field) => (
              <label key={field} className="settings-row">
                <span>{fieldLabel(field)}</span>
                <span className="settings-row-control">
                  <input
                    type="text"
                    name={field}
                    className="settings-text settings-text-wide"
                    value={values[field] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                    autoFocus={field === 'title'}
                  />
                </span>
              </label>
            ))}
            {error && <p className="settings-error">{error}</p>}
            <div className="template-dialog-actions">
              <button className="import-mode-cancel" onClick={() => setSelected(null)}>
                Back
              </button>
              <button className="dialog-action-primary" onClick={() => void handleCreate()}>Create</button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
