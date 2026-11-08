<div align="center">
  <img src="logos/app-icon.svg" alt="Null Notes" width="96" height="96">

  # Null Notes

  A WYSIWYG Markdown note-taking app for CS coursework — math, code,
  hand-drawn diagrams with a stylus, and a PDF import pipeline for
  reference material.

  [![CI](https://github.com/TorresVisual/null-notes/actions/workflows/ci.yml/badge.svg)](https://github.com/TorresVisual/null-notes/actions/workflows/ci.yml)
  ![Tauri](https://img.shields.io/badge/shell-Tauri%202-24C8DB?logo=tauri&logoColor=white)
  ![React](https://img.shields.io/badge/frontend-React%2019-61DAFB?logo=react&logoColor=black)
  ![Rust](https://img.shields.io/badge/backend-Rust-000000?logo=rust&logoColor=white)
  ![Platform](https://img.shields.io/badge/platform-Windows%20%C2%B7%20Linux%20%C2%B7%20Android%20%C2%B7%20iOS-0078D6)
</div>

---

Desktop-primary (Tauri, Windows first), local-first, and offline. Notes are
plain `.md` files on disk, never locked into a proprietary format — see
[Storage model](#storage-model).

> **Status:** solo-maintainer, personal daily-driver project. Releases ship
> as installers with an in-app updater (see [Installing](#installing)), and
> the app is built and polished to a real-stranger-opening-it-cold bar —
> see [`PRODUCT.md`](PRODUCT.md).

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Installing](#installing)
- [Getting started](#getting-started)
- [Commands](#commands)
- [Storage model](#storage-model)
- [Syncing a workspace](#syncing-a-workspace)
- [Project structure](#project-structure)
- [`nullnotes` CLI](#nullnotes-cli)
- [Agent skills](#agent-skills)
- [Documentation](#documentation)

## Features

- **WYSIWYG Markdown editor** (TipTap/ProseMirror) — headings, code blocks
  with syntax highlighting (runnable, and openable in your IDE), tables,
  task lists, theorem/proof/algorithm callouts, collapsible sections,
  inline/block LaTeX math, Mermaid diagrams, footnotes, `[[wiki-links]]`
  and note embeds, cross-references, and code deep-links.
- **Properties and Bases** — YAML frontmatter edited in place without
  disturbing its formatting, plus `.base` files: database-style table, list,
  cards and kanban views over note properties, in Obsidian's syntax.
- **Canvases and diagrams** — standalone JSON Canvas (`.canvas`) boards and
  Excalidraw diagrams stored beside the note.
- **Inline ink** — stylus-first handwriting and diagrams via Canvas +
  perfect-freehand, stored as sidecar files next to the note.
- **PDF import with no OCR** — reads a PDF's own text layer and reconstructs
  2D layout (matrices, cases, fractions, tables) and equations as real,
  editable LaTeX.
- **Git integration** — auto-detects notes-only vs. code-repo workspaces,
  batched auto-commit, fast-forward-only auto-pull; push is never automatic
  in a code-repo workspace. Per-note version history.
- **Spaced repetition** — inline-authored flashcards (`front :: back`,
  cloze) scheduled with SM-2 or FSRS.
- **Search and organization** — full-text search with `folder:`/`tag:`/
  `type:` filters, tags, backlinks, a graph view, bookmarks, an outline
  panel, a workspace-wide task view, formula sheet generation, templates,
  PDF export and printing, and a PTY-backed terminal pane.
- **Scriptable** — a `nullnotes` CLI and agent skills; see
  [below](#nullnotes-cli).

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

## Installing

**[⬇ Download the latest release](https://github.com/TorresVisual/null-notes-releases/releases/latest)** —
this repo is private, so downloads are published to the public
[`null-notes-releases`](https://github.com/TorresVisual/null-notes-releases)
mirror.

| Platform | Get                                                                     |
| -------- | ----------------------------------------------------------------------- |
| Windows  | `Null.Notes_<version>_x64-setup.exe` or `.msi` — run it; it replaces any older version in place |
| Linux    | `.AppImage`, `.deb` or `.rpm`                                           |
| Android  | `.apk` (arm64, sideload)                                                |
| iOS      | AltStore source `https://raw.githubusercontent.com/TorresVisual/null-notes-releases/main/altstore.json` |

Linux and mobile builds are attached only to releases that were built
for those targets, so check the release's asset list. Installed copies check for updates at startup and offer to install them.
Checksums, SBOMs, AltStore setup and the release process are in
[`docs/installing.md`](docs/installing.md).

## Getting started

Requires Node 22 (see [`.nvmrc`](.nvmrc)) and the Rust toolchain pinned in
[`rust-toolchain.toml`](rust-toolchain.toml); `rustup` installs it on first
use.

```bash
npm install
npm run tauri dev     # launch the desktop app in dev mode
npm run dev:web       # or: the frontend alone in a browser (port 1422), Tauri calls stubbed
```

Importing a PDF needs the native `pdfium` library, which isn't committed to
git. Windows release builds bundle it automatically; for `npm run tauri dev`,
fetch it yourself with `./scripts/download-pdfium.ps1` (downloads from
[bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries) and
drops `pdfium.dll` next to `src-tauri/target/{debug,release}/null-notes.exe`).
Everything else about the app works without it — this only gates the PDF
import feature.

## Commands

```bash
# Frontend
npm run dev                  # Vite dev server (frontend only)
npm run build                # production frontend build
npm run typecheck            # tsc --noEmit
npm run lint                 # eslint
npm test                     # vitest run
npm run test:coverage        # vitest with coverage report

# Backend (from src-tauri/)
cargo build                  # build the Tauri backend
cargo test                   # run Rust tests
cargo clippy -- -D warnings  # lint (must pass clean)
cargo fmt --check            # formatting gate
cargo audit                  # known-vulnerability scan
cargo deny check             # licences, bans, advisories

# Full app
npm run tauri dev            # launch the desktop app in dev mode
npm run tauri build          # package an installer

# End-to-end
npm run test:e2e             # builds the CLI and a debug app, runs e2e/specs/

# Release (maintainer)
npm run release -- patch     # bump, tag, push; see docs/installing.md
```

CI runs the checks above on pull requests and on manual dispatch, not on
every push to `main` — run them locally before pushing.

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
    cli_server/   Named-pipe server the CLI talks to
  cli/            `nullnotes` CLI crate

src/              React frontend
  components/     Shared UI components
  editor/
    extensions/   TipTap custom node extensions
  ink/            Canvas drawing + SVG serialization
  hooks/          Custom React hooks
  store/          Global state (Zustand)
  lib/            Pure utilities (no React)
  web/            Browser shims for @tauri-apps/* (dev:web)

skills/           Agent skills plugin
e2e/              End-to-end specs (WebdriverIO)
docs/             Roadmap, CLI contract, install and release notes
```

## `nullnotes` CLI

`nullnotes` reads, searches and edits a workspace from a shell or a coding
agent through the running app (it starts a hidden instance if needed).
Output is one JSON line per call:

```bash
nullnotes --help                                    # every command
printf '# Idea\n\nbody\n' | nullnotes note create --folder "" --title Idea --content -
```

The full contract is in [`docs/cli.md`](docs/cli.md).

## Agent skills

Four skills teach a coding agent (Claude Code, or any tool that reads `SKILL.md`) how to work in a Null Notes workspace correctly. They live in [`skills/`](skills/) and ship as one plugin, `null-notes`.

- `nullnotes-cli` — read, search and edit notes through the `nullnotes` CLI
- `null-notes-markdown` — the Markdown the app renders, sidecar paths, and what it does not support
- `brainstorm-canvas` — append-only brainstorm passes in a `.canvas` file (`/null-notes:brainstorm-canvas <path> <topic>`)
- `null-notes-bases` — `.base` files and the functions the evaluator implements

The repo is private, so install from a local clone or with `gh` authentication:

```
/plugin marketplace add TorresVisual/null-notes
/plugin marketplace add D:/path/to/null-notes
/plugin install null-notes@null-notes
```

Use one of the `marketplace add` lines, not both. To try the skills without installing, run `claude --plugin-dir D:/path/to/null-notes`.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — architecture, save-path invariants, and coding
  conventions
- [`PRODUCT.md`](PRODUCT.md) — product purpose, positioning, and brand
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what's built and what's next
- [`docs/installing.md`](docs/installing.md) — installing, updating, and
  cutting a release
- [`docs/cli.md`](docs/cli.md) — the `nullnotes` CLI contract
- [`docs/design-tokens.md`](docs/design-tokens.md) — the Terminal Precision
  design tokens
