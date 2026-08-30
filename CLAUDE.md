# null-notes

A WYSIWYG Markdown note-taking app for CS students. Desktop-primary (Tauri + Windows), inline ink support, PDF import pipeline.

## Stack

- **Shell:** Tauri 2
- **Backend:** Rust (file I/O, PDF pipeline, OCR orchestration)
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
- No clippy warnings — `.github/workflows/ci.yml` checks this (`cargo clippy -- -D warnings`), but only on `pull_request` or manual `workflow_dispatch`, not on push. This repo commits straight to `main`, so a bad push isn't caught automatically — run `cargo clippy -- -D warnings` locally before pushing
- Formatting is checked, not auto-fixed, on that same trigger (`cargo fmt --check`). The auto-fix-and-commit step lives in the separate `format.yml` workflow, which is manual-dispatch only — it does not run on push. Run `cargo fmt` locally before pushing rather than relying on CI to catch or fix it

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

Equations are rebuilt as LaTeX, not cropped — a cropped image can't be pasted into a prompt, searched, or edited, and doesn't render through the editor's own KaTeX nodes. A LaTeX PDF contains no LaTeX either, but which face a glyph came from carries most of its meaning: `pdf/maths.rs` classifies the face (`CMMI` a variable, `CMSY` a relation, `MSBM` blackboard bold, …), and `pdf/latex.rs` turns face plus geometry into text — smaller and off-baseline is a script, consecutive upright letters are an operator name. A maths region is a direct slice of the page's character row, so it bypasses `layout.rs`'s own gap-based space synthesis and has to redo it locally against the same `SPACE_GAP`. A footnote marker and a real exponent are the same geometry (raised, reduced size); the only distinguishing signal is that an exponent never follows terminal punctuation. `throwOnError: false` on both maths nodes means a bad equation renders its own KaTeX error rather than breaking anything around it.

Glyphs are not the only input. A fraction bar is a **drawn rule**, not a character, so it never reaches the text layer — and it is the only record of how many fraction terms a row carries and where each one begins. `pdf/rules.rs` holds that geometry (pdfium-free, like `columns.rs`; `extract.rs` translates `PdfPageObject::Path` into it), and `reconstruct_ruled_fractions` uses each bar's x-span to split a row of side-by-side fractions that the older gap-ranking passes can only guess at. Take rule geometry from `bounds()`, never `segments()` — pdfium reports segment coordinates in the path's own object space, so a full-width page rule reads `0,0 → 595.3,0` wherever it actually sits. A bar's span alone cannot tell a fraction bar from page furniture, because a full-width separator's span contains every prose row on the page; width relative to the surrounding content is what separates them.

Judging this pipeline means looking at real output: `pdf/dump.rs` holds `#[ignore]`d diagnostics driven by `NULL_NOTES_PDF`. Every bug found so far was invisible in synthetic fixtures.

**The pipeline is frozen** (roadmap §P4-2e). The ten sheets in `notes/exercise_sheets/` are the regression suite and adding one is a deliberate decision. A new bug earns work only if it is whole-document — silent prose loss, mid-word tearing — or recurs across two or more of them; single-document cosmetic bugs get recorded in `TODO.md` under "Filed, not fixed" and left. 2D-layout reconstruction is closed: matrices, `\cases`, stacked fractions, operator limits, tables and ruled fractions are the complete set, and anything else renders as glyph-order text. `pdf/exercises.rs` is the one part still open to change, and it works on the assembled Markdown rather than on `Block`s because an exercise spans page breaks while blocks exist one region at a time.

---

## Launching external processes

`commands/editor_launch.rs` runs the user's editor on a path **taken from note text**, and a note is a hand-editable file that may arrive by Git pull, by Syncthing, or out of a converted PDF. The target is attacker-influenced and the sink is process execution, so three properties are structural rather than checks:

- **No shell.** `std::process::Command` with one `.arg()` per argument. Never `sh -c` or `cmd /c`.
- **Tokenize the command template *before* substitution, never after.** Splitting a filled-in string back into words reintroduces exactly the injection this prevents. The tokenizer never sees a resolved path.
- **Refuse any path component that is not `Component::Normal`** — as written, never normalised and then compared. Normalising opens a gap between the string that was checked and the string that runs. `commands/assets.rs`'s `resolve_relative` is the same rule for file reads.

Anything that resolves must also exist; an unresolvable link renders inert rather than launching. A failed existence lookup marks its targets unresolved, so this fails inert and never open.

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

### Styling

The app shell (Layout, Sidebar, TabBar, dialogs/overlays, command palette, folder context menu) runs on Tailwind CSS v4 + shadcn/ui; `src/components/ui/` is generated but owned — edit it directly, it's not a vendored dependency. The TipTap editor surface stays on plain CSS in `src/index.css`, untouched by this.

Every shadcn component reads Terminal Precision's existing tokens through a bridge block in `src/index.css`'s `:root` (see `docs/design-tokens.md`'s "shadcn/ui token bridge") — never hardcode a color for a new one. Tailwind utilities live in `@layer utilities`; any pre-existing unlayered selector (`.sidebar button`, `.context-menu button`, …) always beats a same-property Tailwind utility regardless of specificity, so a new shadcn component dropped inside an old container needs the old selector scoped/removed, or its `className` pointed at the existing class so that CSS wins on purpose.

`cn()` (clsx + tailwind-merge) lives in `src/lib/utils.ts`. `@/*` resolves to `src/*` (both `tsconfig.json` and `vite.config.ts`).

### TipTap extensions

Each custom node type lives in its own file under `src/editor/extensions/`. Export a configured `Extension` object, not a raw class.

Markdown conversion has no central serializer — `tiptap-markdown` drives it, and each node carries its own `addStorage().markdown.serialize/parse`. A node without one serializes as escaped plain text.

Spellcheck is one editor-wide setting on the ProseMirror root; non-prose nodes (code, maths, mermaid, tags, wiki-links) set `spellcheck="false"` and rely on attribute inheritance to opt out. A new node that renders non-prose text needs the same, or it gets underlined.

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
cargo llvm-cov --summary-only  # coverage report (from src-tauri/); no enforced threshold

# Frontend
npm run dev                  # Vite dev server
npm run build                # production build
npm run typecheck            # tsc --noEmit
npm test                     # vitest run
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

### Issue tracker

Issues are tracked manually as checkbox items in `TODO.md` at the repo root — no GitHub Issues, no per-ticket files. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout — `CONTEXT.md` and `docs/adr/` at the repo root, created lazily when needed. See `docs/agents/domain.md`.
