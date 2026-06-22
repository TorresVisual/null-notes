# null-notes

A WYSIWYG Markdown note-taking app for CS students. Desktop-primary (Tauri + Windows), inline ink support, PDF import pipeline.

## Stack

- **Shell:** Tauri 2
- **Backend:** Rust (file I/O, PDF pipeline, OCR orchestration)
- **Frontend:** React 19 + TypeScript (strict)
- **Editor:** TipTap 2 (ProseMirror)
- **Ink:** Canvas API + perfect-freehand
- **Storage:** Plain `.md` files + SQLite index

## Project Structure

```
src-tauri/        Rust backend
  src/
    commands/     Tauri IPC commands (one file per domain)
    pdf/          PDF pipeline (render, OCR, parse)
    ink/          SVG serialization helpers
    db/           SQLite queries

src/              React frontend
  components/     Shared UI components
  editor/
    extensions/   TipTap custom node extensions
    serializer/   TipTap JSON ↔ Markdown
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

### Naming

- Functions and variables: `snake_case`
- Types, structs, enums: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Modules: `snake_case`

### Style

- Prefer `impl Trait` return types for iterators and closures
- Avoid unnecessary `.clone()` — pass references where possible
- Derive `Debug` on all structs
- Keep Tauri commands thin: parse input, delegate to a domain module, return result
- Run `cargo clippy -- -D warnings` before committing — no clippy warnings allowed

---

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
npm run lint                 # ESLint

# Full app
npm run tauri dev            # launch desktop app in dev mode
npm run tauri build          # package installer
```
