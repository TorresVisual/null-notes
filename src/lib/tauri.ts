import { invoke } from '@tauri-apps/api/core'
import type { NoteMetadata, WorkspaceState, WorkspaceTree, SearchResult, AppSettings, GraphLink, GraphTag, RepoMode, CommitOutcome, PushOutcome, PullOutcome, RebaseOutcome, RepoInitOutcome, TemplateMetadata, CrossRefTarget, OpenTask, DueCard, Grade, NoteHistoryEntry, GithubRepo, BacklinkEntry, PrinterInfo, McGradeResult, CardSummary, ErrorLogEntry, CodeLinkStatus, CodeLinkTarget } from '../types'
import type { PdfPage, PdfMarkdownImport } from '../pdf/types'
import { useWorkspaceStore } from '../store/workspace'
import { sidecarDir } from './pathPrefix'
import { isMobile } from './platform'
import { getStoredGitToken } from './gitCredentials'

export const api = {
  notes: {
    list: (workspace: string) =>
      invoke<NoteMetadata[]>('list_notes', { workspace }),
    scan: (workspace: string) =>
      invoke<WorkspaceTree>('scan_workspace', { workspace }),
    open: (workspace: string, path: string) =>
      invoke<string>('open_note', { workspace, path }),
    save: (workspace: string, path: string, content: string) =>
      invoke<void>('save_note', { workspace, path, content }),
    reindex: (path: string, workspace: string, content: string) =>
      invoke<void>('reindex_note', { path, workspace, content }),
    reindexFromDisk: (path: string, workspace: string) =>
      invoke<boolean>('reindex_from_disk', { path, workspace }),
    create: (workspace: string, folder: string, title: string) =>
      invoke<NoteMetadata>('create_note', { workspace, folder, title }),
    rename: (path: string, newTitle: string, workspace: string) =>
      invoke<NoteMetadata>('rename_note', { path, newTitle, workspace }),
    delete: (workspace: string, path: string) =>
      invoke<void>('delete_note', { workspace, path }),
    search: (
      workspace: string,
      query: string,
      folder: string | null,
      tag: string | null,
      blockType: string | null,
      allWorkspaces = false,
    ) =>
      invoke<SearchResult[]>('search_notes', {
        workspace,
        query,
        folder,
        tag,
        blockType,
        allWorkspaces,
      }),
    listTags: (workspace: string) =>
      invoke<string[]>('list_tags', { workspace }),
    notesWithTag: (workspace: string, tag: string) =>
      invoke<NoteMetadata[]>('notes_with_tag', { workspace, tag }),
    renameTag: (oldTag: string, newTag: string, workspace: string) =>
      invoke<number>('rename_tag', { oldTag, newTag, workspace }),
    backlinksFor: (workspace: string, title: string) =>
      invoke<NoteMetadata[]>('backlinks_for', { workspace, title }),
    backlinksForWithContext: (workspace: string, title: string) =>
      invoke<BacklinkEntry[]>('backlinks_for_with_context', { workspace, title }),
    codeBacklinksForWithContext: (workspace: string, target: string) =>
      invoke<BacklinkEntry[]>('code_backlinks_for_with_context', { workspace, target }),
    unlinkedMentionsForWithContext: (workspace: string, title: string, notePath: string) =>
      invoke<BacklinkEntry[]>('unlinked_mentions_for_with_context', { workspace, title, notePath }),
    createFolder: (parent: string, name: string) =>
      invoke<string>('create_folder', { parent, name }),
    splitIntoTasks: (markdown: string) =>
      invoke<string>('split_into_tasks', { markdown }),
    resolveCodeLinks: (
      workspace: string,
      notePath: string,
      targets: CodeLinkTarget[],
    ) => invoke<CodeLinkStatus[]>('resolve_code_links', { workspace, notePath, targets }),
    openInEditor: (workspace: string, target: string, line: number | null) =>
      invoke<void>('open_in_editor', { workspace, target, line }),
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
    gradeMcCard: (path: string, position: number, picked: number[], workspace: string) =>
      invoke<McGradeResult>('grade_mc_card', { path, position, picked, workspace }),
    setCardSuspended: (path: string, position: number, suspended: boolean, workspace: string) =>
      invoke<void>('set_card_suspended', { path, position, suspended, workspace }),
    listAllCards: (workspace: string) =>
      invoke<CardSummary[]>('list_all_cards', { workspace }),
    listCramCards: (workspace: string, streak: number, struggling: boolean) =>
      invoke<DueCard[]>('list_cram_cards', { workspace, streak, struggling }),
  },
  templates: {
    list: (workspace: string) =>
      invoke<TemplateMetadata[]>('list_templates', { workspace }),
    read: (workspace: string, path: string) =>
      invoke<string>('read_template', { workspace, path }),
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
    initialSelectFile: () =>
      invoke<string | null>('initial_select_file'),
  },
  git: {
    detectRepo: (workspace: string) =>
      invoke<RepoMode | null>('detect_repo', { workspace }),
    detectPriorAutomation: (workspace: string) =>
      invoke<boolean>('detect_prior_automation', { workspace }),
    autoCommit: (workspace: string, mode: RepoMode, paths: string[], skipHooks: boolean) =>
      invoke<CommitOutcome>('auto_commit', { workspace, mode, paths, skipHooks }),
    pushNotes: async (workspace: string, mode: RepoMode, allowCodeRepoPush: boolean) => {
      const args: Record<string, unknown> = { workspace, mode, allowCodeRepoPush }
      if (isMobile()) args.token = await getStoredGitToken()
      return invoke<PushOutcome>('push_notes', args)
    },
    fetchAndCompare: async (workspace: string) => {
      const args: Record<string, unknown> = { workspace }
      if (isMobile()) args.token = await getStoredGitToken()
      return invoke<PullOutcome>('fetch_and_compare', args)
    },
    rebaseOntoRemote: (workspace: string) =>
      invoke<RebaseOutcome>('rebase_onto_remote', { workspace }),
    initNotesRepo: (workspace: string, createGithubRemote: boolean) =>
      invoke<RepoInitOutcome>('init_notes_repo', { workspace, createGithubRemote }),
    listNoteHistory: (workspace: string, notePath: string) =>
      invoke<NoteHistoryEntry[]>('list_note_history', { workspace, notePath }),
    readNoteAtCommit: (workspace: string, relativePath: string, sha: string) =>
      invoke<string>('read_note_at_commit', { workspace, relativePath, sha }),
    listGithubRepos: () =>
      invoke<GithubRepo[]>('list_github_repos'),
    cloneRepo: async (url: string, parentDir: string) => {
      const args: Record<string, unknown> = { url, parentDir }
      if (isMobile()) args.token = await getStoredGitToken()
      return invoke<string>('clone_repo', args)
    },
    getGitToken: () =>
      invoke<string>('get_git_token'),
    setGitToken: (token: string) =>
      invoke<void>('set_git_token', { token }),
  },
  settings: {
    load: () =>
      invoke<AppSettings>('load_settings'),
    save: (settings: AppSettings) =>
      invoke<void>('save_settings', { settings }),
  },
  errorLog: {
    record: (source: string, message: string, context: string | null) =>
      invoke<void>('record_error', { source, message, context }),
    list: () =>
      invoke<ErrorLogEntry[]>('list_errors'),
    clear: () =>
      invoke<void>('clear_errors'),
  },
  assets: {
    write: async (notePath: string, mime: string, data: number[]): Promise<string> => {
      const relative = await invoke<string>('write_note_asset', { notePath, mime, data })
      // Otherwise a pasted/dropped image never enters the auto-commit's
      // pending list — only the note.md that links to it does.
      useWorkspaceStore.getState().addGitPendingPath(sidecarDir(notePath, 'assets'))
      return relative
    },
    read: (notePath: string, relative: string) =>
      invoke<string>('read_note_asset', { notePath, relative }),
    gc: (notePath: string, content: string) =>
      invoke<void>('gc_note_assets', { notePath, content }),
  },
  pdf: {
    ensureDir: (notePath: string) =>
      invoke<string>('ensure_pdf_dir', { notePath }),
    importPages: async (pdfPath: string, notePath: string): Promise<PdfPage[]> => {
      const pages = await invoke<PdfPage[]>('import_pdf_pages', { pdfPath, notePath })
      // Otherwise imported PDF pages never enter the auto-commit's pending
      // list — only the note.md that embeds them does.
      useWorkspaceStore.getState().addGitPendingPath(sidecarDir(notePath, 'pdf'))
      return pages
    },
    readPage: (path: string) =>
      invoke<string>('read_pdf_page', { path }),
    hasTextLayer: (pdfPath: string) =>
      invoke<boolean>('pdf_has_text_layer', { pdfPath }),
    importMarkdown: (pdfPath: string) =>
      invoke<PdfMarkdownImport>('import_pdf_markdown', { pdfPath }),
  },
  terminal: {
    open: (workspace: string, notePath: string | null) =>
      invoke<void>('terminal_open', { workspace, notePath }),
    write: (data: string) =>
      invoke<void>('terminal_write', { data }),
    resize: (cols: number, rows: number) =>
      invoke<void>('terminal_resize', { cols, rows }),
    close: () =>
      invoke<void>('terminal_close'),
  },
  codeRun: {
    run: (runId: string, language: string, source: string, timeoutSecs: number) =>
      invoke<void>('run_code', { runId, language, source, timeoutSecs }),
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
