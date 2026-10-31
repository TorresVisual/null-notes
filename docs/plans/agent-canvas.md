# Agent Canvas Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Open, view, edit and live-reload a `.canvas` (JSON Canvas + pass extension fields) file in any workspace, so a human can verify an external agent's brainstorm passes by eye.

**Architecture:** The `.canvas` is plain JSON read and written through the existing `open_note` / `save_note` commands (generic: workspace-bound path check + `write_atomic`, no DB work). Pure parse/serialize/merge logic lives in `src/lib/`; a `useCanvas` hook owns buffer, save and external-change merge; a React Flow view renders it. Rust adds only: scan/list, create, a separate `canvas-changed` watcher event, and two guards so canvases never enter the note index.

**Tech Stack:** Tauri 2 / Rust, React 19, TypeScript strict, Zustand, `@xyflow/react` (new), Vitest.

**Spec:** `docs/specs/agent-canvas-design.md`

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- `.canvas` lives inside the workspace; no new app-data state. Pretty-printed JSON, one node/edge per block (line-oriented git merges).
- Valid JSON Canvas superset: top-level `lastPass`; agent elements carry `pass` and `author: "agent"`; user elements carry neither. Unknown fields survive round-trip.
- `pass` is permanent identity; editing an agent card's text sets `edited: true`; move/resize is not an edit.
- File-card paths are untrusted: no shell, every component `Component::Normal` as written, target must exist or the card is inert (`src-tauri/src/commands/CLAUDE.md`).
- Agent elements are coloured by the app per pass number (8-colour palette from design tokens, cycling after 8, no hardcoded colours); an agent's `color` field is preserved but not rendered.
- Writes go through `write_atomic`. A dirty canvas is never overwritten from disk. Never overwrite a file that failed to parse (read-only + error banner).
- Desktop only. No `.md` file changes. Canvas is out of search, backlinks and graph. Delete goes through the existing recoverable trash.
- Viewport is stored in `.workspace.json`, never in the `.canvas`.
- Dialog/chrome CSS: grep `src/index.css` for every className introduced before calling a task done.

## Review Focus

Failure modes the spec implies but does not spell out (each is pinned by a test in the owning task):

1. **Our save clobbers an agent write that landed after our last read** — save must re-read disk and merge first (Task 5).
2. **Zero-byte / whitespace-only `.canvas`** (agent or user `touch`ed it) — treat as an empty canvas, not "malformed" (Task 1).
3. **Agent bugs: edge pointing at a missing node, duplicate ids, unknown node `type`** — render what is valid, skip/inert the rest, preserve everything on save (Task 1, 6).
4. **Backslash traversal in file cards on Windows (`..\secret`)** — rejected like `../` (Task 1).
5. **Deleting a pass leaves dangling hand-drawn edges** to its removed cards — remove those edges, keep hand-added cards (Task 1).

---

### Task 1: JSON Canvas model (pure)

**Files:**
- Create: `src/lib/jsonCanvas.ts`
- Test: `src/lib/jsonCanvas.test.ts`

**Interfaces:**
- Produces:
  - `interface CanvasNode { id: string; type: string; x: number; y: number; width: number; height: number; pass?: number; author?: 'agent'; edited?: boolean; [extra: string]: unknown }` (also `text?`, `file?`, `line?`, `label?`, `color?` as `unknown`-narrowed fields)
  - `interface CanvasEdge { id: string; fromNode: string; toNode: string; label?: string; pass?: number; author?: 'agent'; [extra: string]: unknown }`
  - `interface Canvas { nodes: CanvasNode[]; edges: CanvasEdge[]; lastPass: number; [extra: string]: unknown }`
  - `parseCanvas(raw: string): { ok: true; canvas: Canvas } | { ok: false; error: string }` — whitespace-only → empty canvas (`lastPass: 0`); missing `lastPass` → max `pass` present, else 0.
  - `serializeCanvas(canvas: Canvas): string` — 2-space pretty JSON, one node/edge object per block, key order stable, unknown fields kept.
  - `passColorIndex(pass: number): number` → `1..8`, cycling.
  - `membersOf(canvas: Canvas, groupId: string): CanvasNode[]` — nodes whose rect lies fully inside the group's rect (geometric).
  - `deletePass(canvas: Canvas, pass: number): Canvas` — removes the group and every node/edge with that `pass`, plus any edge whose endpoint was removed; hand-added nodes survive; `lastPass` unchanged.
  - `markEdited(node: CanvasNode, text: string): CanvasNode` — sets `edited: true` only if `node.pass !== undefined` and text differs.
  - `isSafeWorkspacePath(path: string): boolean` — false for empty, absolute (`/x`, `C:\x`, `\\x`), any segment `..`, `.` or empty, splitting on both `/` and `\`.

- [ ] **Step 1: Write failing tests** in `jsonCanvas.test.ts`, one per bullet above. Pin: `parseCanvas('  \n')` → ok, `nodes: []`; `parseCanvas('{')` → `ok: false`; unknown top-level key and unknown node key survive `serialize(parse(x))`; `passColorIndex(1)=1`, `(8)=8`, `(9)=1`; `deletePass` on a canvas with a hand-added card inside the pass rectangle and a hand-drawn edge from that card to a pass card → card stays, edge gone; `isSafeWorkspacePath` rejects `'..\\secret'`, `'a/../b'`, `'C:\\x'`, `'/x'`, accepts `'src/net/retry.ts'` and `'Lecture 7.assets/a.png'`; parse keeps an edge whose `toNode` doesn't exist (not dropped).
- [ ] **Step 2: Run** `npx vitest run src/lib/jsonCanvas.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the interfaces above in `src/lib/jsonCanvas.ts`. Pure TS, no React. Narrow `unknown` rather than using `any`.
- [ ] **Step 4: Run** the same command — Expected: PASS. Then `npm run typecheck` — clean.
- [ ] **Step 5: Commit** — `git add src/lib/jsonCanvas.ts src/lib/jsonCanvas.test.ts && git commit -m "feat(canvas): JSON Canvas model with pass extension fields"`

---

### Task 2: Three-way merge (pure)

**Files:**
- Create: `src/lib/canvasMerge.ts`
- Test: `src/lib/canvasMerge.test.ts`

**Interfaces:**
- Consumes: `Canvas` from Task 1.
- Produces: `mergeCanvas(base: Canvas, mine: Canvas, theirs: Canvas): { merged: Canvas } | { conflicts: string[] }` — `base` is the last disk state we know. Per element id (nodes and edges): added only in `theirs` → added to `merged`; changed only in `theirs` → take theirs; changed only in `mine` → keep mine; changed in both differently, or deleted on one side and changed on the other → id goes in `conflicts`. `lastPass = max(mine, theirs)`. If `conflicts` is non-empty return `{ conflicts }` and no merge.

- [ ] **Step 1: Write failing tests**: (a) theirs appended a whole pass (group + 3 cards + edge, `lastPass` 1→2) while mine moved card `a` → merged has both; (b) both moved the same card to different coordinates → `{ conflicts: ['a'] }`; (c) mine deleted `a`, theirs unchanged → stays deleted; (d) mine deleted `a`, theirs edited `a` → conflict; (e) identical mine and theirs → merged equals mine; (f) `lastPass` takes the max.
- [ ] **Step 2: Run** `npx vitest run src/lib/canvasMerge.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `mergeCanvas`. Compare elements with a stable JSON key-sorted equality helper (local to the file).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(canvas): three-way merge for concurrent agent and user edits`

---

### Task 3: Rust — scan, create, watcher, index guards, viewport state

**Files:**
- Modify: `src-tauri/src/commands/notes.rs` (`scan_dir_recursive` ~L842, `scan_workspace`, `WorkspaceTree` construction ~L938; add `create_canvas`)
- Modify: `src-tauri/src/commands/watcher.rs` (`is_note_path`, event emit)
- Modify: `src-tauri/src/commands/trash.rs` (`restore_at` ~L236)
- Modify: `src-tauri/src/models.rs` (`WorkspaceTree`, `WorkspaceState`)
- Modify: `src-tauri/src/lib.rs` (register `create_canvas`)

**Interfaces:**
- Produces:
  - `WorkspaceTree.canvases: Vec<String>` (absolute paths, `#[serde(default)]`).
  - `#[tauri::command] pub async fn create_canvas(workspace: String, folder: String, name: String) -> Result<String, String>` — writes `{"nodes":[],"edges":[],"lastPass":0}` pretty-printed via `write_atomic` to `<folder>/<sanitized name>.canvas`, returns the path; errors if it exists or `folder` is outside the workspace (`require_within_workspace`). Reuse the filename sanitiser `create_note` uses.
  - Watcher event `canvas-changed` (payload `Vec<String>` paths), debounced in the same batch as `workspace-changed`. `.canvas` paths are **not** emitted on `workspace-changed` (that path calls `reindex_from_disk`, which would index JSON as a note).
  - `WorkspaceState.canvas_viewports: HashMap<String, CanvasViewport>` with `#[serde(default)]`; `#[derive(Debug, Clone, Serialize, Deserialize, Default)] struct CanvasViewport { x: f64, y: f64, zoom: f64 }`.

- [ ] **Step 1: Write failing Rust tests**: scan returns `Notes/map.canvas` in `canvases` and a `.canvas` under `x.ink/` or `.git/` is skipped; a folder containing only a canvas is kept in `folders` (the `shown` set); `is_canvas_path` accepts `/ws/a.canvas`, rejects `/ws/.a.canvas.abc.tmp` and `/ws/.git/a.canvas`; `create_canvas` writes parseable JSON, refuses a second call with the same name, refuses a folder outside the workspace; `restore_at` of a trashed `.canvas` leaves `notes` index untouched (no row for it); a `.workspace.json` without `canvas_viewports` still deserialises.
- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml canvas` — Expected: FAIL.
- [ ] **Step 3: Implement.** In `scan_dir_recursive` collect `.canvas` files (mark `shown.insert(dir)`), return them via a third tuple element or a small struct — keep call sites compiling (`restore_at` and `scan_workspace` both call it). In `watcher.rs` generalise `is_note_path` into a private `has_visible_ext(path, ext)` and add `is_canvas_path`; in the debounce loop partition canvas paths out and emit `canvas-changed`. In `restore_at`, skip `index_note_at` when the restored path doesn't end in `.md`.
- [ ] **Step 4: Run** `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check` (from `src-tauri/`) — Expected: all clean.
- [ ] **Step 5: Commit** — `feat(canvas): scan, create and watch .canvas files; keep them out of the note index`

---

### Task 4: Frontend plumbing — tree, tabs, create, routing

**Files:**
- Modify: `src/types/index.ts` (`WorkspaceTree.canvases: string[]`; `WorkspaceState.canvasViewports`)
- Modify: `src/web/memoryWorkspace.ts` (return `canvases: []` so the web build typechecks)
- Modify: `src/lib/tauri.ts` (`api.canvas.create(workspace, folder, name)`)
- Modify: `src/store/notes.ts` (`canvases: string[]`, `setCanvases`)
- Modify: `src/lib/folderTree.ts` (`CanvasTreeNode { type: 'canvas'; name; path }`, `buildFolderTree(root, folders, notes, canvases = [])`)
- Modify: `src/components/TreeNode.tsx` (canvas row: click → `openTab`, context menu with delete via `api.notes.delete` + `offerUndoDelete`; folder context menu gains "New canvas")
- Create: `src/hooks/useCreateCanvas.ts` → `useCreateCanvas(): (folder: string) => Promise<void>` (prompts via `promptText`, calls `api.canvas.create`, `refreshTree()`, `openTab`)
- Modify: `src/hooks/useWorkspace.ts` (`refreshTree` also sets canvases), `src/hooks/useExternalChanges.ts` (listen `canvas-changed` → `refreshTree()`)
- Modify: `src/components/Layout.tsx` (+ `TabBar.tsx` title lookup)
- Create: `src/lib/canvasPath.ts` → `isCanvasPath(path: string): boolean`
- Test: `src/lib/folderTree.test.ts`, `src/lib/canvasPath.test.ts`

**Interfaces:**
- Produces: `isCanvasPath`; `CanvasTreeNode`; tabs hold canvas paths like note paths.

- [ ] **Step 1: Write failing tests**: `buildFolderTree` places `ws/Notes/map.canvas` under `Notes` as `type: 'canvas'` with `name: 'map'`; `isCanvasPath('a/b.canvas')` true, `'a/b.canvas.md'` false.
- [ ] **Step 2: Run** `npx vitest run src/lib/folderTree.test.ts src/lib/canvasPath.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the files above. **Critical in `Layout.tsx`:** `useNote(activeTab)` and `EditorPane` must not receive a canvas path — `NoteEditor` would autosave the JSON as Markdown. Compute `const canvasTab = activeTab && isCanvasPath(activeTab)`; pass `null` to `useNote` when true and render `<CanvasPane path={activeTab} />` (stub returning a placeholder until Task 6) in place of `EditorPane`. Do the same for `secondaryTab` (refuse to open a canvas as the secondary pane).
- [ ] **Step 4: Run** the tests, then `npm run typecheck` and `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(canvas): .canvas files in the tree, tabs and New canvas action`

---

### Task 5: `useCanvas` hook

**Files:**
- Create: `src/hooks/useCanvas.ts`
- Test: `src/hooks/useCanvas.test.ts`

**Interfaces:**
- Consumes: `parseCanvas`, `serializeCanvas`, `mergeCanvas`, `api.notes.open/save`, `listen('canvas-changed')`.
- Produces: `useCanvas(path: string): { canvas: Canvas | null; error: string | null; readOnly: boolean; update: (next: Canvas) => void; saveState: SaveState; conflict: boolean; keepMine: () => void; reloadTheirs: () => void; appendedPasses: number[] }`
  - `appendedPasses` = pass numbers newly present after the last external merge (drives Task 7), cleared by reading it once per merge.

Behaviour: keeps `base` (last disk text parsed) and `recentWrites` (same ring as `useNote`, size 4). On `canvas-changed` including `path`: read disk; if text equals the buffer or any recent write → ignore; if buffer is clean → adopt; if dirty → `mergeCanvas(base, buffer, theirs)`; `{merged}` → adopt silently, `{conflicts}` → `conflict = true`. **Save (debounced like `useNote`, `SAVE_DEBOUNCE_MS`) first re-reads disk; if it differs from `base`, merge before writing** (Review Focus 1). Parse failure on load → `error` set, `readOnly = true`, no save ever issued. Successful save calls `addGitPendingPath(path)`.

- [ ] **Step 1: Write failing tests** (mock `api` and `listen` as `useNote.test.ts` does): (a) own save echoing back raises no conflict; (b) agent appends pass 2 while buffer is dirty → buffer contains it, `conflict` false, `appendedPasses` = `[2]`; (c) same card moved on both sides → `conflict` true and nothing written; (d) at save time disk has an extra pass not in `base` → the written text contains it; (e) malformed JSON → `readOnly` true and `api.notes.save` never called after `update`; (f) `reloadTheirs` adopts disk and clears `conflict`.
- [ ] **Step 2: Run** `npx vitest run src/hooks/useCanvas.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `useCanvas`. Reuse `SaveState` and `SAVE_DEBOUNCE_MS` from `useNote.ts`; do not copy them.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(canvas): useCanvas hook with external-change merge`

---

### Task 6: Canvas view (React Flow)

**Files:**
- Modify: `package.json` (`npm install @xyflow/react`)
- Create: `src/components/CanvasPane.tsx` (loads `useCanvas`, banner for `error`, `ConflictBar` on `conflict` — add an optional `message` prop to `ConflictBar` since its text says "note")
- Create: `src/components/canvas/CanvasView.tsx`, `src/components/canvas/canvasNodes.tsx` (text / file / group node renderers)
- Create: `src/lib/canvasFlow.ts` — `toFlow(canvas): { nodes: Node[]; edges: Edge[] }`, `applyFlowChanges(canvas: Canvas, changes: NodeChange[] | EdgeChange[]): Canvas`
- Modify: `src/index.css` (canvas chrome classes; `--pass-1…--pass-8` mapped to existing tokens per `docs/design-tokens.md`)
- Test: `src/lib/canvasFlow.test.ts`

**Interfaces:**
- Consumes: Task 1 model, Task 5 hook, `api.codeLinks`-equivalent `resolveCodeLinks(workspace, notePath, [{target, line}])` and `openInEditor(workspace, target, line)` (both exist in `src/lib/tauri.ts`).

Behaviour: Agent elements take border/tint from `--pass-${passColorIndex(pass)}`; their `color` is ignored; user cards may use their own. Group label shows `Pass n · topic`; question card is just the first text node in the group (no special type). `edited: true` renders a small marker. Edges drop from the rendered set when an endpoint is missing but stay in `canvas`. Unknown node types render as inert generic cards. File card: render inert unless `isSafeWorkspacePath(file)` **and** `resolveCodeLinks` returns `ok`; click on `.md` → `useWorkspaceStore.openTab(join(workspace, file))`, otherwise `openInEditor(workspace, file, line ?? null)`. User actions: drag/resize, add text card, add file card (prompt for path), draw labelled edge, delete card/edge, delete pass (`deletePass`, confirm first), text edit via `markEdited`. Dragging a group moves `membersOf` cards by the same delta.

- [ ] **Step 1: Write failing tests** for `canvasFlow.ts`: `toFlow` skips an edge whose `toNode` is missing; `applyFlowChanges` for a position change updates `x`/`y` only and preserves unknown fields and `pass`; resize updates `width`/`height`; node removal of a pass card removes its edges.
- [ ] **Step 2: Run** `npx vitest run src/lib/canvasFlow.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `canvasFlow.ts`, then the components. Mount React Flow through `useEditor`-style real mounts only in e2e; jsdom needs `ResizeObserver`/`DOMMatrixReadOnly` stubs in `src/test-setup.ts` if a component test is added (not required here).
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`; then grep `src/index.css` for every new className (CLAUDE.md dialog-CSS gap) and view in a browser via the `ui-preview` skill against a hand-written fixture `.canvas` — check spacing against a reference element, not just that the class exists.
- [ ] **Step 5: Commit** — `feat(canvas): React Flow canvas view with pass colouring and light editing`

---

### Task 7: Pass legend, arrival cue, viewport memory

**Files:**
- Create: `src/components/canvas/PassLegend.tsx`
- Modify: `src/components/canvas/CanvasView.tsx`, `src/store/workspace.ts` (+ `useWorkspace.ts` persistence checkpoints) for `canvasViewports`
- Test: `src/components/canvas/PassLegend.test.tsx`, `src/store/workspace.test.ts`

**Interfaces:**
- Consumes: `appendedPasses` (Task 5), `showToast(message)` from `src/store/toast.ts`, `WorkspaceState.canvas_viewports` (Task 3).
- Produces: `PassLegend({ passes, hidden, onToggle, onShowOnlyLatest })`; `workspace store: setCanvasViewport(path: string, v: {x: number; y: number; zoom: number}): void`, `canvasViewports: Record<string, {x,y,zoom}>`.

Behaviour: legend = one row per pass (colour swatch, `Pass n`, eye toggle) + "Show only latest"; hidden passes hide their group, cards and edges in the view only. On `appendedPasses` non-empty: `fitView` onto the newest pass's group, one-shot pulse class on it, `showToast('Pass N added')`. Viewport saved on move-end (debounced) and restored on open; keyed by canvas path and must follow `replaceOpenPath` renames like tabs do.

- [ ] **Step 1: Write failing tests**: legend toggle calls `onToggle(2)`; "Show only latest" hides all but the max pass; `setCanvasViewport` round-trips through the store's save checkpoint.
- [ ] **Step 2: Run** `npx vitest run src/components/canvas src/store/workspace.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** as described.
- [ ] **Step 4: Run** the tests plus `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(canvas): pass legend, new-pass cue and per-canvas viewport`

---

### Task 8: Docs and end-to-end check

**Files:**
- Modify: `docs/ROADMAP.md` L113 (reword row, do not delete): `Won't build as a freeform surface inside notes; agent-canvas file added 2026-10-31 as a narrow exception (see agent-canvas-design.md).`
- Modify: `CLAUDE.md` storage-boundary list: add `NoteName.canvas` files and `canvasViewports` in `.workspace.json`.
- Create: `e2e/specs/agent-canvas.e2e.ts` (follow `.claude/skills/e2e-verify/`)

- [ ] **Step 1: Write the e2e spec**: fixture workspace with a `.canvas` holding pass 1; open it; assert the group label `Pass 1`; externally rewrite the file with a pass 2 appended (atomic temp+rename, as the agent protocol says); assert `Pass 2` appears, a "Pass 2 added" toast shows, and no conflict bar. Then create a card by hand and assert the saved file still contains both passes.
- [ ] **Step 2: Run** `npm run test:e2e -- --spec e2e/specs/agent-canvas.e2e.ts` — Expected: PASS; screenshot inspected per the e2e-verify skill.
- [ ] **Step 3: Apply the docs edits** above.
- [ ] **Step 4: Run** the full gate: `npm run typecheck && npm test`, and from `src-tauri/`: `cargo test && cargo clippy -- -D warnings && cargo fmt --check`.
- [ ] **Step 5: Commit** — `docs(canvas): record agent canvas exception and add e2e coverage`

---

## Self-review notes

- **Spec coverage:** format → T1; agent protocol consumer side (append merge, atomic write) → T2/T5; create/open/tree/tabs → T3/T4; renderer, editing, file-card safety → T6; legend/arrival/viewport → T7; ROADMAP reword + storage-boundary doc → T8; trash/restore → T3 (existing `delete_note` reused); malformed → T5/T6.
- **Deliberate deviations from the spec text:** no new `open_canvas`/`save_canvas` commands (existing `open_note`/`save_note` are generic and already path-bound); `.canvas` gets its own `canvas-changed` event instead of `workspace-changed`; whitespace-only file is an empty canvas rather than an error.
- **Not planned (spec silent):** renaming a `.canvas`; the tree shows it by filename sans extension.
