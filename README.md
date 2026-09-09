<div align="center">
  <img src="logos/app-icon.svg" alt="null-notes" width="96" height="96">

  # null-notes

  A WYSIWYG Markdown note-taking app for CS coursework — math, code,
  hand-drawn diagrams with a stylus, and a PDF import pipeline for
  reference material.

  [![CI](https://github.com/TorresVisual/null-notes/actions/workflows/ci.yml/badge.svg)](https://github.com/TorresVisual/null-notes/actions/workflows/ci.yml)
  ![Tauri](https://img.shields.io/badge/shell-Tauri%202-24C8DB?logo=tauri&logoColor=white)
  ![React](https://img.shields.io/badge/frontend-React%2019-61DAFB?logo=react&logoColor=black)
  ![Rust](https://img.shields.io/badge/backend-Rust-000000?logo=rust&logoColor=white)
  ![Platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)
</div>

---

Desktop-primary (Tauri + Windows), local-first, and offline. Notes are
plain `.md` files on disk, never locked into a proprietary format — see
[Storage model](#storage-model).

> **Status:** solo-maintainer, personal daily-driver project. Not currently
> distributed, but built and polished to a real-stranger-opening-it-cold
> bar regardless — see [`PRODUCT.md`](PRODUCT.md).

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Commands](#commands)
- [Storage model](#storage-model)
- [Syncing a workspace](#syncing-a-workspace)
- [Project structure](#project-structure)
- [Documentation](#documentation)

## Features

- **WYSIWYG Markdown editor** (TipTap/ProseMirror) — headings, code blocks
  with syntax highlighting, tables, task lists, theorem/proof/algorithm
  callouts, collapsible sections, inline/block LaTeX math, Mermaid diagrams,
  cross-references, and code deep-links.
- **Inline ink** — stylus-first handwriting and diagrams via Canvas +
  perfect-freehand, stored as sidecar files next to the note.
- **PDF import with no OCR** — reads a PDF's own text layer and reconstructs
  2D layout (matrices, cases, fractions, tables) and equations as real,
  editable LaTeX.
- **Git integration** — auto-detects notes-only vs. code-repo workspaces,
  batched auto-commit, fast-forward-only auto-pull; push is never automatic
  in a code-repo workspace.
- **Spaced repetition** — inline-authored SM-2 flashcards (`front :: back`,
  cloze).
- **Search and organization** — full-text search with `folder:`/`tag:`/
  `type:` filters, tags, backlinks, a workspace-wide task view, formula
  sheet generation, templates, and a PTY-backed terminal pane.

## Tech stack

| Layer     | Tech                                              |
| --------- | -------------------------------------------------- |
| Shell     | [Tauri 2](https://tauri.app/)                      |
| Backend   | Rust (file I/O, PDF pipeline)                      |
| Frontend  | React 19 + TypeScript (strict)                     |
| Editor    | [TipTap 3](https://tiptap.dev/) (ProseMirror)      |
| Styling   | Tailwind v4 + shadcn/ui (app shell), plain CSS (editor) |
| Ink       | Canvas API + [perfect-freehand](https://github.com/steveruizok/perfect-freehand) |
| Storage   | Plain `.md` files + SQLite index                   |

## Getting started

Requires Node 22+ and the Rust stable toolchain (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

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

## Commands

```bash
# Frontend
npm run dev                  # Vite dev server (frontend only)
npm run build                # production frontend build
npm run typecheck            # tsc --noEmit
npm test                     # vitest run

# Backend (from src-tauri/)
cargo build                  # build the Tauri backend
cargo test                   # run Rust tests
cargo clippy -- -D warnings  # lint (must pass clean)
cargo fmt --check            # formatting gate

# Full app
npm run tauri dev            # launch the desktop app in dev mode
npm run tauri build          # package an installer

# End-to-end
npm run test:e2e             # rebuilds via `tauri build --debug`, runs e2e/specs/
```

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

## Project structure

```
src-tauri/        Rust backend
  src/
    commands/     Tauri IPC commands (one file per domain)
    pdf/          PDF pipeline (render, parse)
    db/           SQLite queries

src/              React frontend
  components/     Shared UI components
  editor/
    extensions/   TipTap custom node extensions
  ink/            Canvas drawing + SVG serialization
  hooks/          Custom React hooks
  store/          Global state (Zustand)
  lib/            Pure utilities (no React)
```

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — architecture, save-path invariants, and coding
  conventions
- [`PRODUCT.md`](PRODUCT.md) — product purpose, positioning, and brand
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what's built and what's next
