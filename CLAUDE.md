# Null Notes

A WYSIWYG Markdown note-taking app for CS students. Desktop-primary (Tauri + Windows), ink drawing (inline preview, full-screen pan/zoom editor), PDF import pipeline.

## Stack

- **Shell:** Tauri 2
- **Backend:** Rust (file I/O, PDF pipeline)
- **Frontend:** React 19 + TypeScript (strict)
- **Editor:** TipTap 3 (ProseMirror)
- **Styling:** Tailwind v4 + shadcn/ui (app shell) · plain CSS in `src/index.css` (editor)
- **Ink:** Canvas API + perfect-freehand
- **Storage:** Plain `.md` files + SQLite index

## Project Structure

```
src-tauri/        Rust backend
  src/
    commands/     Tauri IPC commands (one file per domain)
    pdf/          PDF pipeline (render, parse)
    db/           SQLite queries
  cli/            `nullnotes` CLI crate (separate Cargo.toml)

src/              React frontend
  components/     Shared UI components
  editor/
    extensions/   TipTap custom node extensions
  ink/            Canvas drawing + SVG serialization
  hooks/          Custom React hooks
  store/          Global state (Zustand)
  lib/            Pure utilities (no React)
  web/            Browser shims for @tauri-apps/* (dev:web / build:web)
```

`vite.web.config.ts` aliases each `@tauri-apps/*` module the frontend imports to a shim in `src/web/`. Importing a Tauri module not aliased there breaks `build:web` — add the shim in the same change.

---

## Rust Guidelines

### Error handling

Use `anyhow` for Tauri command errors. Use `thiserror` for domain-specific error types.

```rust
// commands return Result<T, String> for Tauri serialization
#[tauri::command]
pub async fn import_pdf(path: String) -> Result<Document, String> {
    pdf::import(&path).await.map_err(|e| e.to_string())
}

// internal functions return anyhow::Result
async fn import(path: &str) -> anyhow::Result<Document> { ... }
```

Never use `.unwrap()` or `.expect()` outside of tests. Use `?` to propagate errors.

### Async

Use `tokio` for all async. Long-running operations (PDF render, code execution) run in `tokio::task::spawn_blocking` or a dedicated thread to avoid blocking the async executor.

### Style

- Prefer `impl Trait` return types for iterators and closures
- Avoid unnecessary `.clone()` — pass references where possible
- Derive `Debug` on all structs
- Keep Tauri commands thin: parse input, delegate to a domain module, return result
- No clippy warnings — `.github/workflows/ci.yml` checks this (`cargo clippy -- -D warnings`), but only on `pull_request` or manual `workflow_dispatch`, not on push. This repo commits straight to `main`, so a bad push isn't caught automatically — run `cargo clippy -- -D warnings` locally before pushing
- Formatting is checked, not auto-fixed, on that same trigger (`cargo fmt --check`). The auto-fix-and-commit step lives in the separate `format.yml` workflow, which is manual-dispatch only — it does not run on push. Run `cargo fmt` locally before pushing rather than relying on CI to catch or fix it

---

## The save path

Data integrity rules. Breaking one of these silently loses or corrupts a note.

- **Note writes go through `write_atomic`** (temp file → fsync → rename), never `tokio::fs::write`. A half-written `.md` is corruption.
- **`save_note` does no database work.** It writes the file; `reindex_note` carries FTS/tags/links on a slower debounce. Keeping DB work off the keystroke path is the point — don't merge them back.
- **The watcher reports our own writes back to us.** Before treating a `workspace-changed` event as an external edit, check the disk against both the buffer and the last content we wrote, or normal typing raises a false conflict.
- **A dirty buffer is never overwritten from disk.** External changes to an edited note prompt; they don't auto-reload.
- **One buffer per note path.** `src/store/noteBuffers.ts` owns content, timers, `recentWrites` and the watcher listener, ref-counted per path; `useNote` only subscribes. Editor groups showing the same note share it — never give a second view its own copy, or two writers race on one file.

---

## The storage boundary

Where a file lives decides whether it syncs. That is the whole contract between storage and sync, so it's a decision to make deliberately, not a side effect of picking a path.

- **Inside the workspace folder** — travels with the notes: `.md` files, `NoteName.ink/`, `NoteName.pdf/`, `NoteName.diagrams/` and `NoteName.assets/` sidecars, standalone `Name.canvas` files (JSON Canvas with `pass` extension fields, pretty-printed one node/edge per block so it merges; the canvas is a file of its own, not a sidecar), `Name.base` files (Bases definitions, YAML in Obsidian's syntax; a file of its own, listed beside canvases in `WorkspaceTree.canvases`), `.bookmarks` (sidebar bookmarks, one JSON entry per line so it merges), and `.workspace.json` (UI state, gitignored; includes per-canvas `canvasViewports`, never stored in the `.canvas`, and the editor-group `layout`).
- **In the OS app-data dir** — stays on this machine: `index.db`, `settings.json`, `recent-workspaces.json`, `cli-token`, `logs/` (daily-rotating `tracing` files; `NULLNOTES_LOG=debug` raises verbosity).

`index.db` is outside because a binary SQLite file cannot be merged across machines, and it's safe to exclude only because it's rebuildable — those two facts hold each other up. Ink, PDF and image sidecars are inside because a note whose drawings or figures didn't travel with it is a broken note.

Sidecar directories are named after the note (`Lecture 7.assets/`), so their paths routinely contain spaces. A path that reaches a `.md` file has to be URL-encoded, because a bare space ends a Markdown link destination. Encode at the Markdown boundary only — the in-memory attribute holds the raw path, since `encodeURI` escapes `%` and so is not idempotent.

**Adding new state?** Pick the column before picking a file format. Anything inside the workspace is content that other machines will merge, so its format has to survive that. Anything that is neither note content nor rebuildable from note content needs the decision recorded in `docs/ROADMAP.md` §1.

---

## Note properties

Frontmatter is the source of truth for properties; `note_properties` in `index.db` is rebuildable and filled in `reindex_note`, never `save_note`. `src-tauri/src/properties.rs` edits the frontmatter text surgically (comments, key order, quoting and list style survive) and refuses to edit frontmatter that doesn't parse. Every edit is re-parsed and must yield exactly the intended properties, or it is refused.

---

## The PDF pipeline

No OCR — a typeset PDF's own text layer is read exactly, never recognised from pixels. Structure, pdfium gotchas, maths/LaTeX reconstruction and the frozen-pipeline regression policy are documented in `src-tauri/src/pdf/CLAUDE.md`; read it before touching anything under `pdf/`.

---

## Commands: process execution

`src-tauri/src/commands/CLAUDE.md` covers the two places this backend spawns a process from note-derived input — launching the user's editor and running a note's code blocks — and the structural (not just checked) rules that keep both injection-safe.

The `nullnotes` CLI reaches the app over a local named pipe whose dispatcher is an allowlist, so it is a third way in; its rules are in the same file under "The CLI pipe", and the user-facing contract is `docs/cli.md`.

## TypeScript Guidelines

### Config

Strict mode is on. These are errors, not warnings:

- `any` — never use it; use `unknown` and narrow, or write the type
- Non-null assertions (`!`) — only when the null case is structurally impossible
- Implicit `any` from missing type annotations on public APIs

### Naming

- Components: `PascalCase` (file and export)
- Hooks: `useCamelCase`
- Utilities and plain functions: `camelCase`
- Types and interfaces: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE` for module-level, `camelCase` for local

### Exports

- Named exports everywhere except route/page-level components
- No barrel `index.ts` files unless the directory has 5+ exports

### Types

Prefer `interface` for object shapes that may be extended. Use `type` for unions, intersections, and aliases.

```ts
// good
interface NoteMetadata {
  id: string
  title: string
  path: string
}

// good
type EditorMode = 'text' | 'ink' | 'select'
```

---

## React Guidelines

### Components

- Functional components only — no class components
- One component per file
- Keep components focused: if a component needs more than ~150 lines, split it
- Props typed inline with `interface`, not imported from another file unless shared

```tsx
interface InkBlockProps {
  src: string
  width: number
  height: number
  locked: boolean
}

export function InkBlock({ src, width, height, locked }: InkBlockProps) { ... }
```

### State

- Local state: `useState` / `useReducer`
- Shared state: Zustand store in `src/store/`
- No prop drilling past 2 levels — lift to store or context

### Hooks

Extract any stateful logic longer than ~5 lines into a custom hook in `src/hooks/`.

```ts
// good — logic lives in the hook
const { strokes, addStroke, undo } = useInkCanvas(canvasRef)

// bad — logic lives in the component
```

### Styling

The app shell (Layout, Sidebar, TabBar, dialogs/overlays, command palette, folder context menu) runs on Tailwind CSS v4 + shadcn/ui; `src/components/ui/` is generated but owned — edit it directly, it's not a vendored dependency. The TipTap editor surface stays on plain CSS in `src/index.css`, untouched by this.

Every shadcn component reads Terminal Precision's existing tokens through a bridge block in `src/index.css`'s `:root` (see `docs/design-tokens.md`'s "shadcn/ui token bridge") — never hardcode a color for a new one. Tailwind utilities live in `@layer utilities`; any pre-existing unlayered selector (`.sidebar button`, `.context-menu button`, …) always beats a same-property Tailwind utility regardless of specificity, so a new shadcn component dropped inside an old container needs the old selector scoped/removed, or its `className` pointed at the existing class so that CSS wins on purpose.

`cn()` (clsx + tailwind-merge) lives in `src/lib/utils.ts`. `@/*` resolves to `src/*` (both `tsconfig.json` and `vite.config.ts`).

In practice, every app-shell dialog (Settings, Task view, Template picker, Shortcuts, the graph view) renders its *content* through plain `src/index.css` classes, not Tailwind utilities — `Dialog`/`DialogContent` from `src/components/ui/dialog.tsx` supply the overlay/positioning, but the card chrome and everything inside it is `.settings-panel` and friends (`.settings-panel-header/-body/-footer/-close`, `.settings-reset`, `.template-empty-hint`, …). A new dialog reuses those classes for its chrome rather than inventing its own — add only the CSS a new list/row actually needs, and register the dialog's outer class in the `surface-in` keyframe selector list. A className with no matching rule in `index.css` renders as unstyled text; this has bitten every dialog added without checking first (e.g. the error log viewer), so grep `index.css` for the classNames a new dialog introduces before calling it done.

### TipTap extensions

Each custom node type lives in its own file under `src/editor/extensions/`. Export a configured `Extension` object, not a raw class.

Markdown conversion has no central serializer — `tiptap-markdown` drives it, and each node carries its own `addStorage().markdown.serialize/parse`. A node without one serializes as escaped plain text.

Spellcheck is not the WebView's: native checking is forced off on the rich editor and the `Spellcheck` extension draws its own squiggles from the Hunspell dictionaries bundled in the Rust backend (`src-tauri/dictionaries/`, `spell.rs`; `de` and `en`, plus `tech.txt` for CS terms). A note's `lang` frontmatter property picks the dictionary, falling back to `spellcheckLanguage`; the personal dictionary is `spellcheckWords` in `settings.json`. A new node that renders non-prose text must be added to `NON_PROSE_NODES` (or `NON_PROSE_MARKS`) in `Spellcheck.ts`, or it gets underlined. The raw Markdown `<textarea>` still uses native checking. `de.*` is GPL-2.0/3.0 (igerman98), `en.*` MIT/BSD — licence texts sit beside them.

Key handling that must run *before* the keymap plugins (and so before StarterKit's `ListKeymap`) lives in `NoteEditor`'s `editorProps`, not in an extension — ProseMirror checks direct props first. Any test of key behaviour has to mount with those same `editorProps`, or it exercises an editor the app never builds.

A node backed by `ReactNodeViewRenderer` (wiki-links, and anything else that needs real React inside the editor, e.g. hover previews) only renders its React content when the test mounts through `useEditor`/`EditorContent` — a bare `new Editor()` only shows the static `renderHTML` fallback.

`@tiptap/core` and `@tiptap/pm` are pinned via `overrides` in `package.json`. Without them `starter-kit` pulls a second copy of core and every `Editor`/`Node` type becomes nominally distinct — typecheck fails with unreadable errors far from the cause.

---

## General Principles

- **No comments unless the WHY is non-obvious.** Well-named identifiers do the explaining.
- **No premature abstraction.** Three similar things is not a pattern yet.
- **No defensive code for impossible cases.** Trust internal invariants.
- **No half-finished implementations.** If a feature is out of scope, don't scaffold it.
- **Small diffs.** A PR should do one thing.

---

## Commands

```bash
# Backend
cargo build                  # build Tauri backend
cargo test                   # run Rust tests
cargo clippy -- -D warnings  # lint (must pass clean)
cargo fmt --check            # formatting gate (must pass clean); cargo fmt to apply
cargo audit                  # scan Rust deps for known vulnerabilities (from src-tauri/)
cargo deny check             # licences/bans/advisories (from src-tauri/, config in deny.toml; CI runs it per crate)
cargo llvm-cov --summary-only  # coverage report (from src-tauri/); no enforced threshold
cargo test --release perf_bench -- --ignored --nocapture  # 2,000-note reindex/search timings (src-tauri/); run before releases, no thresholds
cargo +nightly fuzz run fts_query -- -max_total_time=60  # or `properties` (src-tauri/); needs nightly + cargo-fuzz, local only, not in CI

# Frontend
npm run dev                  # Vite dev server
npm run build                # production build
npm run typecheck            # tsc --noEmit
npm run lint                 # eslint; CI gates on it
npm run dev:web              # frontend in a plain browser (port 1422), Tauri calls shimmed
npm test                     # vitest run (NULL_NOTES_MD_CORPUS=<dir> adds a .md round-trip idempotence check)
npm run test:coverage        # vitest run --coverage; no enforced threshold
npm audit                    # scan npm deps for known vulnerabilities

# Full app
npm run tauri dev            # launch desktop app in dev mode
npm run tauri build          # package installer

# End-to-end (drives the real compiled app — see .claude/skills/e2e-verify/)
npm run test:e2e             # rebuilds via `tauri build --debug`, then runs e2e/specs/
```

---

## Agent skills

### Keeping skills true

The plugin in `skills/` documents the CLI, the Markdown dialect, canvases and Bases for external agents. Changing the CLI surface, the `.base` evaluator, the canvas contract or a Markdown node means updating the matching skill in the same change; `src/lib/skills.test.ts` guards the CLI command table and the function list.

### Issue tracker

Bugs and features are tracked as GitHub Issues on `TorresVisual/null-notes` (and `TorresVisual/null-ide` for IDE-side work) — not in `TODO.md`. Use the `file-issue` skill to turn a rough note into a filed issue. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout — `CONTEXT.md` and `docs/adr/` at the repo root, created lazily when needed. See `docs/agents/domain.md`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
