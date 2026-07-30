# null-notes

A WYSIWYG Markdown note-taking app for CS students. Desktop-primary (Tauri + Windows), inline ink support, PDF import pipeline.

## Stack

- **Shell:** Tauri 2
- **Backend:** Rust (file I/O, PDF pipeline, OCR orchestration)
- **Frontend:** React 19 + TypeScript (strict)
- **Editor:** TipTap 3 (ProseMirror)
- **Ink:** Canvas API + perfect-freehand
- **Storage:** Plain `.md` files + SQLite index

## Project Structure

```
src-tauri/        Rust backend
  src/
    commands/     Tauri IPC commands (one file per domain)
    pdf/          PDF pipeline (render, OCR, parse)
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

Use `tokio` for all async. Long-running operations (OCR, PDF render) run in `tokio::task::spawn_blocking` to avoid blocking the async executor.

### Style

- Prefer `impl Trait` return types for iterators and closures
- Avoid unnecessary `.clone()` — pass references where possible
- Derive `Debug` on all structs
- Keep Tauri commands thin: parse input, delegate to a domain module, return result
- Run `cargo clippy -- -D warnings` before committing — no clippy warnings allowed

---

## The save path

Data integrity rules. Breaking one of these silently loses or corrupts a note.

- **Note writes go through `write_atomic`** (temp file → fsync → rename), never `tokio::fs::write`. A half-written `.md` is corruption.
- **`save_note` does no database work.** It writes the file; `reindex_note` carries FTS/tags/links on a slower debounce. Keeping DB work off the keystroke path is the point — don't merge them back.
- **The watcher reports our own writes back to us.** Before treating a `workspace-changed` event as an external edit, check the disk against both the buffer and the last content we wrote, or normal typing raises a false conflict.
- **A dirty buffer is never overwritten from disk.** External changes to an edited note prompt; they don't auto-reload.

---

## The storage boundary

Where a file lives decides whether it syncs. That is the whole contract between storage and sync, so it's a decision to make deliberately, not a side effect of picking a path.

- **Inside the workspace folder** — travels with the notes: `.md` files, `NoteName.ink/`, `NoteName.pdf/` and `NoteName.assets/` sidecars, and `.workspace.json` (UI state, gitignored).
- **In the OS app-data dir** — stays on this machine: `index.db`, `settings.json`, `recent-workspaces.json`.

`index.db` is outside because a binary SQLite file cannot be merged across machines, and it's safe to exclude only because it's rebuildable — those two facts hold each other up. Ink, PDF and image sidecars are inside because a note whose drawings or figures didn't travel with it is a broken note.

Sidecar directories are named after the note (`Lecture 7.assets/`), so their paths routinely contain spaces. A path that reaches a `.md` file has to be URL-encoded, because a bare space ends a Markdown link destination. Encode at the Markdown boundary only — the in-memory attribute holds the raw path, since `encodeURI` escapes `%` and so is not idempotent.

**Adding new state?** Pick the column before picking a file format. Anything inside the workspace is content that other machines will merge, so its format has to survive that. Anything that is neither note content nor rebuildable from note content needs the decision recorded in `docs/ROADMAP.md` §1.

---

## The PDF pipeline

No OCR. A typeset PDF carries its own text layer, and reading it is exact where recognising pixels would only ever be a guess.

`pdf/layout.rs` reconstructs document structure (lines, blocks, headings, code, lists, emphasis) from plain `CharBox` values and **must not gain a pdfium dependency**. Nothing in CI has the pdfium native library — the render tests are `#[ignore]`d for that reason — so a pdfium-free module is the only part of this pipeline that can actually be tested. `pdf/extract.rs` is the translation layer: it turns pdfium types into `CharBox` and makes no decisions. Put judgement in `layout`, plumbing in `extract`.

Use `loose_bounds()`, not `tight_bounds()` — tight bounds cover a glyph's inked extent, so gap-based space detection fires after every comma. pdfium is synchronous, so page work belongs in `spawn_blocking`.

Two things about pdfium that cost real debugging time:

- It injects **synthetic characters** describing the text layer's own structure (CR/LF at every line end, spacing markers). They report a font size of 1.0 with zero bounds, and are identified by an **empty font name** — real glyphs always have one. Keeping them drags a row's median font size to 1.0 and collapses the baseline tolerance, which shreds the whole document.
- It binds its library **once per process**, not once per call — `bind_pdfium()` on the *second* PDF imported in a running session answers `PdfiumLibraryBindingsAlreadyInitialized` rather than returning the bindings. Treat that as success (`Pdfium::default()` reuses the live bindings), never as "pdfium not found".

Equations are rebuilt as LaTeX, not cropped — a cropped image can't be pasted into a prompt, searched, or edited, and doesn't render through the editor's own KaTeX nodes. A LaTeX PDF contains no LaTeX either, but which face a glyph came from carries most of its meaning: `pdf/maths.rs` classifies the face (`CMMI` a variable, `CMSY` a relation, `MSBM` blackboard bold, …), and `pdf/latex.rs` turns face plus geometry into text — smaller and off-baseline is a script, consecutive upright letters are an operator name. A maths region is a direct slice of the page's character row, so it bypasses `layout.rs`'s own gap-based space synthesis and has to redo it locally against the same `SPACE_GAP`. A footnote marker and a real exponent are the same geometry (raised, reduced size); the only distinguishing signal is that an exponent never follows terminal punctuation. Multi-line vector/matrix notation has no single-baseline representation at all and is out of scope — `throwOnError: false` on both maths nodes means a bad equation renders its own KaTeX error rather than breaking anything around it.

Judging this pipeline means looking at real output: `pdf/dump.rs` holds `#[ignore]`d diagnostics driven by `NULL_NOTES_PDF`. Every bug found so far was invisible in synthetic fixtures.

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
- Server/file data: React Query (TanStack Query)

### Hooks

Extract any stateful logic longer than ~5 lines into a custom hook in `src/hooks/`.

```ts
// good — logic lives in the hook
const { strokes, addStroke, undo } = useInkCanvas(canvasRef)

// bad — logic lives in the component
```

### TipTap extensions

Each custom node type lives in its own file under `src/editor/extensions/`. Export a configured `Extension` object, not a raw class.

Markdown conversion has no central serializer — `tiptap-markdown` drives it, and each node carries its own `addStorage().markdown.serialize/parse`. A node without one serializes as escaped plain text.

Spellcheck is one editor-wide setting on the ProseMirror root; non-prose nodes (code, maths, mermaid, tags, wiki-links) set `spellcheck="false"` and rely on attribute inheritance to opt out. A new node that renders non-prose text needs the same, or it gets underlined.

Key handling that must run *before* the keymap plugins (and so before StarterKit's `ListKeymap`) lives in `NoteEditor`'s `editorProps`, not in an extension — ProseMirror checks direct props first. Any test of key behaviour has to mount with those same `editorProps`, or it exercises an editor the app never builds.

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

# Frontend
npm run dev                  # Vite dev server
npm run build                # production build
npm run typecheck            # tsc --noEmit
npm test                     # vitest run

# Full app
npm run tauri dev            # launch desktop app in dev mode
npm run tauri build          # package installer
```
