// Init script: fakes the Tauri IPC bridge so the shell opens a populated fixture
// workspace in a plain browser. Commands not listed here reject, same as without it.
// Unhandled commands are collected in window.__mockMisses.
// Edit NOTES / FOLDERS / CANVASES to preview other shapes (long titles, deep trees, empty).
(() => {
  const WS = 'C:/preview/Notes'
  const now = Date.now()
  const note = (rel, title, ageMin = 5) => ({
    id: rel,
    title,
    path: `${WS}/${rel}`,
    workspace: WS,
    updatedAt: Math.floor((now - ageMin * 60000) / 1000),
  })

  const NOTES = [
    note('Welcome.md', 'Welcome'),
    note('Algorithms/Big-O Notation.md', 'Big-O Notation', 30),
    note('Algorithms/Dijkstra with a deliberately long title that must truncate in the sidebar.md', 'Dijkstra with a deliberately long title that must truncate in the sidebar', 90),
    note('Lecture 7.md', 'Lecture 7', 600),
  ]
  const FOLDERS = [`${WS}/Algorithms`, `${WS}/Archive`]
  const CANVASES = [`${WS}/Overview.canvas`]

  const CONTENT = {
    [`${WS}/Welcome.md`]: '---\ntags: [cs, week-3]\nstatus: draft\n---\n\n# Welcome\n\nA paragraph with a [[Big-O Notation]] link and #tag.\n\n- [x] Done task\n- [ ] Open task\n\n```ts\nconst a = 1\n```\n',
  }

  const handlers = {
    initial_workspace: () => WS,
    initial_select_file: () => null,
    recent_workspaces: () => [WS],
    remember_workspace: () => [WS],
    load_workspace: () => ({
      openTabs: [`${WS}/Welcome.md`],
      activeTab: `${WS}/Welcome.md`,
      expandedFolders: [`${WS}/Algorithms`],
      recentSearches: [],
      git: {},
    }),
    scan_workspace: () => ({ notes: NOTES, folders: FOLDERS, canvases: CANVASES }),
    list_notes: () => NOTES,
    open_note: (a) => CONTENT[a.path] ?? `# ${a.path.split('/').pop()}\n`,
    list_tags: () => ['cs', 'week-3'],
    read_bookmarks: () => '',
    watch_workspace: () => null,
    save_workspace: () => null,
    save_settings: () => null,
    save_note: () => null,
    reindex_note: () => null,
    report_dirty_paths: () => null,
    record_error: () => null,
    parse_note_properties: () => ({ properties: { tags: ['cs', 'week-3'], status: 'draft' }, error: null }),
    list_open_tasks: () => [],
    list_due_cards: () => [],
    is_release_build: () => false,
    detect_repo: () => null,
    list_trash: () => [],
    backlinks_for_with_context: () => [],
    code_backlinks_for_with_context: () => [],
    unlinked_mentions_for_with_context: () => [],
  }

  const noop = () => undefined
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: noop }
  window.__TAURI_OS_PLUGIN_INTERNALS__ = { platform: 'windows', eol: '\r\n', family: 'windows', version: '10', arch: 'x86_64' }
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => {
      const id = Math.floor(Math.random() * 2 ** 31)
      window[`_${id}`] = cb
      return id
    },
    unregisterCallback: noop,
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      if (cmd.startsWith('plugin:event|')) return 0
      if (cmd.startsWith('plugin:window|')) return cmd.endsWith('is_maximized') ? false : null
      const h = handlers[cmd]
      if (!h) {
        ;(window.__mockMisses ??= []).push(cmd)
        throw new Error(`mock-tauri: no handler for ${cmd}`)
      }
      return h(args ?? {})
    },
  }
})()
