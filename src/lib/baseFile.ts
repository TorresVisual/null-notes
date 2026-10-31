import { Document, isMap, parseDocument } from 'yaml'

export interface BaseView {
  type: string
  name: string
  [key: string]: unknown
}

export interface BaseFile {
  filters?: unknown
  formulas?: Record<string, string>
  properties?: Record<string, { displayName?: string }>
  views: BaseView[]
}

// Wraps the yaml Document so comments and keys we don't implement survive an
// edit. `source` is returned verbatim until the first mutation, so merely
// opening a file never reformats it.
export interface BaseDoc {
  document: Document
  source: string
  dirty: boolean
}

export type ParsedBase =
  | { ok: true; doc: BaseDoc; base: BaseFile }
  | { ok: false; error: string }

export function parseBase(text: string): ParsedBase {
  const document = parseDocument(text)
  const first = document.errors[0]
  if (first) {
    const line = first.linePos?.[0].line
    return { ok: false, error: line ? `Line ${line}: ${first.message}` : first.message }
  }
  if (document.contents !== null && !isMap(document.contents)) {
    return { ok: false, error: 'A base must be a YAML mapping (filters, formulas, views…)' }
  }
  const raw: unknown = document.toJS()
  const base = (raw ?? {}) as Partial<BaseFile>
  return {
    ok: true,
    doc: { document, source: text, dirty: false },
    base: { ...base, views: Array.isArray(base.views) ? base.views : [] },
  }
}

export function serializeBase(doc: BaseDoc): string {
  return doc.dirty ? String(doc.document) : doc.source
}

function mutate(doc: BaseDoc, change: (document: Document) => void): void {
  change(doc.document)
  doc.dirty = true
}

export function updateView(doc: BaseDoc, index: number, patch: Partial<BaseView>): void {
  mutate(doc, (document) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) document.deleteIn(['views', index, key])
      else document.setIn(['views', index, key], document.createNode(value))
    }
  })
}

export function addView(doc: BaseDoc, view: BaseView): void {
  mutate(doc, (document) => {
    if (document.hasIn(['views'])) document.addIn(['views'], document.createNode(view))
    else document.setIn(['views'], document.createNode([view]))
  })
}

export function removeView(doc: BaseDoc, index: number): void {
  mutate(doc, (document) => void document.deleteIn(['views', index]))
}

export function renameView(doc: BaseDoc, index: number, name: string): void {
  updateView(doc, index, { name })
}

export function setFilters(doc: BaseDoc, filters: unknown): void {
  mutate(doc, (document) => {
    if (filters === undefined || filters === null) document.deleteIn(['filters'])
    else document.setIn(['filters'], document.createNode(filters))
  })
}
