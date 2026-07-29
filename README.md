# null-notes

A WYSIWYG Markdown note-taking app for CS coursework: math, code, hand-drawn
diagrams with a stylus, and a PDF import pipeline for reference material.
Desktop-primary (Tauri + Windows), local-first, and offline.

## Storage model

Notes are plain `.md` files on disk — that's the source of truth. A SQLite
index (full-text search, tags, backlinks) sits alongside the workspace folder
and is fully rebuildable from the files at any time; deleting it loses
nothing. Ink drawings are stored as SVG sidecar files next to their note.

Because everything is plain files, syncing a workspace with Git or Syncthing
works without any app-specific setup.

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
