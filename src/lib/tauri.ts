import { invoke } from '@tauri-apps/api/core'
import type { NoteMetadata, WorkspaceState, WorkspaceTree, SearchResult, AppSettings, GraphLink, GraphTag, RepoMode, CommitOutcome, PushOutcome, PullOutcome, RepoInitOutcome, TemplateMetadata, CrossRefTarget, OpenTask, DueCard, Grade, NoteHistoryEntry, BacklinkEntry, PrinterInfo } from '../types'
import type { PdfPage, PdfMarkdownImport } from '../pdf/types'

export const api = {
  notes: {
    list: (workspace: string) =>
      invoke<NoteMetadata[]>('list_notes', { workspace }),
    scan: (workspace: string) =>
      invoke<WorkspaceTree>('scan_workspace', { workspace }),
    open: (path: string) =>
      invoke<string>('open_note', { path }),
    save: (path: string, content: string) =>
      invoke<void>('save_note', { path, content }),
    reindex: (path: string, workspace: string, content: string) =>
      invoke<void>('reindex_note', { path, workspace, content }),
    reindexFromDisk: (path: string, workspace: string) =>
      invoke<boolean>('reindex_from_disk', { path, workspace }),
    create: (workspace: string, folder: string, title: string) =>
      invoke<NoteMetadata>('create_note', { workspace, folder, title }),
    rename: (path: string, newTitle: string, workspace: string) =>
      invoke<NoteMetadata>('rename_note', { path, newTitle, workspace }),
    delete: (path: string) =>
      invoke<void>('delete_note', { path }),
    search: (
      workspace: string,
      query: string,
      folder: string | null,
      tag: string | null,
      blockType: string | null,
    ) => invoke<SearchResult[]>('search_notes', { workspace, query, folder, tag, blockType }),
    listTags: (workspace: string) =>
      invoke<string[]>('list_tags', { workspace }),
    notesWithTag: (workspace: string, tag: string) =>
      invoke<NoteMetadata[]>('notes_with_tag', { workspace, tag }),
    backlinksFor: (workspace: string, title: string) =>
      invoke<NoteMetadata[]>('backlinks_for', { workspace, title }),
    backlinksForWithContext: (workspace: string, title: string) =>
      invoke<BacklinkEntry[]>('backlinks_for_with_context', { workspace, title }),
    createFolder: (parent: string, name: string) =>
      invoke<string>('create_folder', { parent, name }),
    splitIntoTasks: (markdown: string) =>
      invoke<string>('split_into_tasks', { markdown }),
    resolveCodeLinks: (workspace: string, targets: string[]) =>
      invoke<boolean[]>('resolve_code_links', { workspace, targets }),
    openInEditor: (workspace: string, target: string, line: number | null, template: string) =>
      invoke<void>('open_in_editor', { workspace, target, line, template }),
    renameFolder: (oldPath: string, newPath: string) =>
      invoke<void>('rename_folder', { oldPath, newPath }),
    deleteFolder: (path: string) =>
      invoke<void>('delete_folder', { path }),
    moveNote: (path: string, destFolder: string) =>
      invoke<string>('move_note', { path, destFolder }),
    graphLinks: (workspace: string) =>
      invoke<GraphLink[]>('graph_links', { workspace }),
    graphTags: (workspace: string) =>
      invoke<GraphTag[]>('graph_tags', { workspace }),
    resolveCrossRefs: (workspace: string, targets: CrossRefTarget[]) =>
      invoke<(string | null)[]>('resolve_cross_refs', { workspace, targets }),
    listOpenTasks: (workspace: string) =>
      invoke<OpenTask[]>('list_open_tasks', { workspace }),
    toggleTask: (path: string, position: number, workspace: string) =>
      invoke<void>('toggle_task', { path, position, workspace }),
    generateFormulaSheet: (workspace: string, folder: string | null, tag: string | null) =>
      invoke<NoteMetadata>('generate_formula_sheet', { workspace, folder, tag }),
    listDueCards: (workspace: string) =>
      invoke<DueCard[]>('list_due_cards', { workspace }),
    gradeCard: (path: string, position: number, grade: Grade, workspace: string) =>
      invoke<void>('grade_card', { path, position, grade, workspace }),
  },
  templates: {
    list: (workspace: string) =>
      invoke<TemplateMetadata[]>('list_templates', { workspace }),
    read: (path: string) =>
      invoke<string>('read_template', { path }),
    seedDefaults: (workspace: string) =>
      invoke<TemplateMetadata[]>('seed_default_templates', { workspace }),
    createNote: (workspace: string, folder: string, title: string, content: string) =>
      invoke<NoteMetadata>('create_note_from_template', { workspace, folder, title, content }),
  },
  window: {
    confirmClose: () => invoke<void>('confirm_close'),
  },
  workspace: {
    watch: (workspace: string) =>
      invoke<void>('watch_workspace', { workspace }),
    load: (path: string) =>
      invoke<WorkspaceState>('load_workspace', { path }),
    save: (path: string, state: WorkspaceState) =>
      invoke<void>('save_workspace', { path, state }),
    recents: () =>
      invoke<string[]>('recent_workspaces'),
    remember: (path: string) =>
      invoke<string[]>('remember_workspace', { path }),
    initialWorkspace: () =>
      invoke<string | null>('initial_workspace'),
  },
  git: {
    detectRepo: (workspace: string) =>
      invoke<RepoMode | null>('detect_repo', { workspace }),
    autoCommit: (workspace: string, mode: RepoMode, paths: string[], skipHooks: boolean) =>
      invoke<CommitOutcome>('auto_commit', { workspace, mode, paths, skipHooks }),
    pushNotes: (workspace: string, mode: RepoMode, allowCodeRepoPush: boolean) =>
      invoke<PushOutcome>('push_notes', { workspace, mode, allowCodeRepoPush }),
    fetchAndCompare: (workspace: string) =>
      invoke<PullOutcome>('fetch_and_compare', { workspace }),
    initNotesRepo: (workspace: string, createGithubRemote: boolean) =>
      invoke<RepoInitOutcome>('init_notes_repo', { workspace, createGithubRemote }),
    listNoteHistory: (workspace: string, notePath: string) =>
      invoke<NoteHistoryEntry[]>('list_note_history', { workspace, notePath }),
    readNoteAtCommit: (workspace: string, notePath: string, sha: string) =>
      invoke<string>('read_note_at_commit', { workspace, notePath, sha }),
  },
  settings: {
    load: () =>
      invoke<AppSettings>('load_settings'),
    save: (settings: AppSettings) =>
      invoke<void>('save_settings', { settings }),
  },
  assets: {
    write: (notePath: string, mime: string, data: number[]) =>
      invoke<string>('write_note_asset', { notePath, mime, data }),
    read: (notePath: string, relative: string) =>
      invoke<string>('read_note_asset', { notePath, relative }),
  },
  pdf: {
    ensureDir: (notePath: string) =>
      invoke<string>('ensure_pdf_dir', { notePath }),
    importPages: (pdfPath: string, notePath: string) =>
      invoke<PdfPage[]>('import_pdf_pages', { pdfPath, notePath }),
    readPage: (path: string) =>
      invoke<string>('read_pdf_page', { path }),
    hasTextLayer: (pdfPath: string) =>
      invoke<boolean>('pdf_has_text_layer', { pdfPath }),
    importMarkdown: (pdfPath: string) =>
      invoke<PdfMarkdownImport>('import_pdf_markdown', { pdfPath }),
  },
  terminal: {
    open: (workspace: string, notePath: string | null, shell: string) =>
      invoke<void>('terminal_open', { workspace, notePath, shell }),
    write: (data: string) =>
      invoke<void>('terminal_write', { data }),
    resize: (cols: number, rows: number) =>
      invoke<void>('terminal_resize', { cols, rows }),
    close: () =>
      invoke<void>('terminal_close'),
  },
  codeRun: {
    run: (
      runId: string,
      language: string,
      source: string,
      pythonCommand: string,
      cppCompilerCommand: string,
      timeoutSecs: number,
    ) =>
      invoke<void>('run_code', { runId, language, source, pythonCommand, cppCompilerCommand, timeoutSecs }),
    sendInput: (runId: string, text: string) =>
      invoke<void>('send_input', { runId, text }),
    stop: (runId: string) =>
      invoke<void>('stop_run', { runId }),
  },
  printing: {
    listPrinters: () =>
      invoke<PrinterInfo[]>('list_printers'),
    exportPdf: (path: string) =>
      invoke<void>('export_pdf', { path }),
    printDocument: (printerName: string) =>
      invoke<void>('print_document', { printerName }),
  },
}
