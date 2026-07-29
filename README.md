# null-notes

A WYSIWYG Markdown note-taking app for CS coursework: math, code, hand-drawn
diagrams with a stylus, and a PDF import pipeline for reference material.
Desktop-primary (Tauri + Windows), local-first, and offline.

## Storage model

Notes are plain `.md` files on disk — that's the source of truth. A SQLite
index (full-text search, tags, backlinks) lives in the OS app-data
directory, not inside the workspace, and is fully rebuildable from the files
at any time; deleting it loses nothing. Ink drawings, imported PDF pages and
pasted images are stored as sidecar files next to their note
(`NoteName.ink/`, `NoteName.pdf/`, `NoteName.assets/`) — inside the
workspace, so they travel with the notes they belong to.

## Syncing a workspace

Because the index lives outside the workspace and everything inside it is
plain files, a workspace folder is safe to sync with Git, Syncthing, or
similar — there's nothing app-specific to configure. The app watches the
workspace directory and reindexes anything a sync client changes
automatically (add, edit, or delete), so pulling changes on one machine
never needs a manual rescan on another.

The one workspace-local file worth excluding from Git if you use it, since
it's UI state rather than note content, is `.workspace.json` (which tabs
were open, which folders were expanded) — syncing it just means one
machine's open tabs override another's, which is harmless but can be mildly
confusing. A minimal workspace `.gitignore`:

```gitignore
.workspace.json
.*.tmp
```

(`.*.tmp` covers the sibling temp file a crash mid-save could leave behind —
normally renamed away or cleaned up automatically, per the save path in
[CLAUDE.md](CLAUDE.md).)

## Running it

```bash
npm install
npm run tauri dev     # launch the desktop app in dev mode
```

Importing a PDF needs the native `pdfium` library, which isn't vendored —
download the release for your platform from
[bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries)
(the plain `pdfium-*` archive, not the `-v8` one) and place the library file
(`pdfium.dll` on Windows) next to `src-tauri/target/debug/null-notes.exe`
(or wherever the built app lives). Everything else about the app works
without it — this only gates the PDF import feature.

Other commands:

```bash
npm run dev                  # Vite dev server (frontend only)
npm run build                # production frontend build
npm run typecheck            # tsc --noEmit
npm test                     # vitest run

cargo build                  # build the Tauri backend (from src-tauri/)
cargo test                   # run Rust tests
cargo clippy -- -D warnings  # lint (must pass clean)

npm run tauri build          # package an installer
```

See [CLAUDE.md](CLAUDE.md) for architecture and conventions, and
[docs/ROADMAP.md](docs/ROADMAP.md) for what's built and what's next.
