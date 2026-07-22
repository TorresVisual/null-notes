# Visual Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Replace null-notes' ad hoc dark palette and plain-text/emoji buttons with the "Terminal Precision" design system (near-black + signal green, CSS custom-property tokens, Lucide line icons) per `docs/specs/visual-design-system-design.md`.

**Architecture:** A single CSS token layer (`:root` custom properties in `src/index.css`) that every existing selector in that file is recolored to reference, plus a mechanical icon swap in ~10 React components using the new `lucide-react` dependency. Presentational only — no state, props, or behavior changes.

**Tech Stack:** React 19 + TypeScript (strict), plain CSS (no CSS-in-JS/Tailwind in this repo), `lucide-react` (new dependency).

## Global Constraints

- Dark-only for this pass — no light-mode variant (spec: Non-Goals).
- No new features, no layout/sizing restructuring, no changes to editor extension logic or the Rust backend (spec: Non-Goals).
- Icon library is `lucide-react` — do not introduce a second icon set.
- Every button whose visible text/emoji is replaced by an icon MUST retain its existing `aria-label` (or gain one if it previously relied on visible text alone) — accessibility must not regress.
- Callout `tip` color changes from green (`#3dbc6a`) to teal (`#2dd4bf`) to avoid colliding with the new UI accent green. All other callout colors (note/info, warning, danger, important) are unchanged in hue.
- No unit test currently asserts on the button text/emoji being replaced (verified by search across `*.test.{ts,tsx}` during brainstorming) — no test updates are required by this plan.

---

## File Structure

| File | Change |
|---|---|
| `package.json` | Add `lucide-react` dependency |
| `src/index.css` | Add `:root` design tokens; recolor every existing selector to reference them; add net-new `.ink-*` rules (previously unstyled) |
| `src/ink/InkCanvas.tsx` | Swap tool-label text/glyph buttons for Lucide icons |
| `src/editor/NoteEditor.tsx` | Swap "✏ Ink" text for `PenLine` icon + label |
| `src/components/TreeNode.tsx` | Swap "▸"/"▾"/"✕" for Lucide chevrons + `Trash2` |
| `src/components/FolderContextMenu.tsx` | Add icon + label to Rename/Delete menu items |
| `src/components/TabBar.tsx` | Swap "✕" close for `X` icon |
| `src/components/BacklinksPanel.tsx` | Swap "▸"/"▾" toggle for Lucide chevrons |
| `src/components/Sidebar.tsx` | Swap New Note/New Folder text buttons and Search-open button for icon + label |
| `src/components/SearchModal.tsx` | Add `Search` icon to the modal input |
| `src/components/ImportButton.tsx` | Swap "Import PDF" text button for `FileUp` icon + label |
| `src/editor/extensions/Callout.tsx` | Add per-type Lucide icon next to the existing text label |

No files are created; no files are deleted.

---

### Task 1: Add the `lucide-react` dependency

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `lucide-react` importable as `import { IconName } from 'lucide-react'` in all later tasks.

- [ ] **Step 1: Install the package**

Run: `npm install lucide-react`

Expected: `package.json` gains a `"lucide-react": "^X.Y.Z"` entry under `"dependencies"`, `package-lock.json` updates, exit code 0.

- [ ] **Step 2: Verify the import resolves**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -n 5` is not reliable for a bare import check since nothing imports it yet — instead create a throwaway check:

Run (PowerShell or bash, either works — this is a one-off smoke check, not a permanent file):
```bash
node -e "require.resolve('lucide-react/dist/lucide-react.cjs.js')" 2>&1 || node -e "require.resolve('lucide-react')"
```

Expected: no error printed (module resolves). If both resolve attempts error, stop and check the npm install output for failures before continuing.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add lucide-react for the icon system"
```

---

### Task 2: Design tokens — rewrite `src/index.css`

**Files:**
- Modify: `src/index.css` (full-file rewrite; every color/selector below is the complete target state)

**Interfaces:**
- Produces: `:root` custom properties (`--bg-base`, `--bg-raised`, `--bg-sunken`, `--bg-hover`, `--border`, `--border-strong`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-disabled`, `--accent`, `--accent-hover`, `--accent-bg`, `--accent-bg-hover`, `--accent-contrast`, `--danger`, `--space-xs`, `--space-sm`, `--space-md`, `--space-lg`, `--space-xl`, `--space-2xl`) that Task 3 (new `.ink-*` rules) and Task 12 (Callout tip color, already applied here) rely on.
- Consumes: nothing (first CSS task).

- [ ] **Step 1: Replace the full contents of `src/index.css`**

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  /* Backgrounds */
  --bg-base: #0d0f12;
  --bg-raised: #111318;
  --bg-sunken: #0a0b0d;
  --bg-hover: #161b22;

  /* Borders */
  --border: #1f242c;
  --border-strong: #2a2f38;

  /* Text */
  --text-primary: #e6edf3;
  --text-secondary: #9da7b3;
  --text-tertiary: #565f6b;
  --text-disabled: #3a4048;

  /* Accent (signal green) */
  --accent: #7ee787;
  --accent-hover: #a3f0ac;
  --accent-bg: rgba(126, 231, 135, 0.12);
  --accent-bg-hover: rgba(126, 231, 135, 0.22);
  --accent-contrast: #0d0f12;

  /* Semantic */
  --danger: #e05050;

  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;
}

html {
  height: 100%;
  overflow: hidden;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  background: var(--bg-base);
  color: var(--text-primary);
  height: 100%;
  overflow: hidden;
}

#root { height: 100%; display: flex; flex-direction: column; }

/* Thin dark scrollbar for WebKit / WebView2 */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-tertiary); }

/* Layout */
.layout {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 220px;
  min-width: 180px;
  background: var(--bg-raised);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: 12px 8px;
  overflow-y: auto;
}

.sidebar button {
  width: 100%;
  padding: 6px 10px;
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}

.sidebar button:hover { background: var(--border-strong); }
.sidebar button:disabled { opacity: 0.4; cursor: not-allowed; }

.sidebar ul { list-style: none; flex: 1; overflow-y: auto; }

.sidebar li {
  display: flex;
  align-items: center;
  border-radius: 4px;
  margin-bottom: 2px;
}

.sidebar li:hover { background: var(--bg-hover); }

.note-link {
  flex: 1;
  border: none !important;
  background: transparent !important;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-delete {
  flex-shrink: 0;
  width: 24px !important;
  padding: 0 !important;
  text-align: center;
  border: none !important;
  background: transparent !important;
  color: var(--text-tertiary);
  font-size: 11px;
}

.note-delete:hover { color: var(--danger) !important; }

/* Main area */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Tab bar */
.tab-bar {
  display: flex;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  flex-shrink: 0;
}

.tab {
  display: flex;
  align-items: center;
  border-right: 1px solid var(--border);
}

.tab button {
  padding: 6px 12px;
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}

.tab.active button:first-child { color: var(--text-primary); }
.tab:hover { background: var(--bg-hover); }

/* Editor scroll container — full width so the scrollbar sits at the window edge */
.editor-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

/* Editor pane — centers the content column */
.editor-pane {
  max-width: 800px;
  margin: 0 auto;
  padding: 32px 48px;
  min-height: 100%;
}

.note-editor { outline: none; min-height: 100%; }

.note-editor .ProseMirror { outline: none; }

.note-editor .ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: var(--text-disabled);
  pointer-events: none;
  float: left;
  height: 0;
}

.note-editor h1 { font-size: 1.8em; font-weight: 700; letter-spacing: -0.01em; margin: 0.8em 0 0.4em; color: var(--text-primary); }
.note-editor h2 { font-size: 1.4em; font-weight: 700; letter-spacing: -0.01em; margin: 0.8em 0 0.4em; color: var(--text-primary); }
.note-editor h3 { font-size: 1.2em; font-weight: 700; margin: 0.8em 0 0.4em; color: var(--text-primary); }
.note-editor p { margin-bottom: 0.6em; }
.note-editor code {
  background: var(--bg-hover);
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 0.9em;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}
.note-editor pre {
  background: var(--bg-hover);
  padding: 12px 16px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.8em 0;
}
.note-editor pre code { background: none; padding: 0; }

.empty-state, .status {
  color: var(--text-tertiary);
  text-align: center;
  margin-top: 20vh;
  font-size: 14px;
}

/* Sidebar extras */
.workspace-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-pdf { display: flex; flex-direction: column; gap: var(--space-xs); }
.import-progress { font-size: 12px; color: var(--text-secondary); }
.import-error { font-size: 12px; color: var(--danger); }

/* Math blocks */
.block-math {
  padding: 12px 0;
  overflow-x: auto;
  text-align: center;
  user-select: none;
}

.inline-math {
  display: inline;
  user-select: none;
}

/* Ink block placeholder */
.ink-block-wrapper {
  border: 1px dashed var(--border-strong);
  border-radius: 6px;
  margin: 8px 0;
  overflow: hidden;
}

/* Lists */
.note-editor ul,
.note-editor ol {
  padding-left: 1.4em;
  margin-bottom: 0.6em;
}

.note-editor blockquote {
  border-left: 3px solid var(--border-strong);
  padding-left: 1em;
  color: var(--text-secondary);
  margin: 0.6em 0;
}

/* Task list */
.note-editor ul[data-type="taskList"] { list-style: none; padding-left: 0; }
.note-editor ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 6px; }
.note-editor ul[data-type="taskList"] li > label { flex-shrink: 0; margin-top: 3px; }
.note-editor ul[data-type="taskList"] li > div { flex: 1; }
.note-editor ul[data-type="taskList"] li[data-checked="true"] > div { opacity: 0.55; text-decoration: line-through; }

/* Tables */
.note-editor table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.8em 0;
  font-size: 0.93em;
}
.note-editor th,
.note-editor td {
  border: 1px solid var(--border-strong);
  padding: 6px 12px;
  text-align: left;
}
.note-editor th { background: var(--bg-hover); font-weight: 600; }
.note-editor tr:nth-child(even) td { background: var(--bg-hover); }

/* Syntax-highlighted code blocks (lowlight) */
.note-editor pre {
  background: var(--bg-hover);
  padding: 14px 16px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.8em 0;
  font-size: 0.88em;
  line-height: 1.5;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}
.note-editor pre code { background: none; padding: 0; font-size: inherit; }

/* lowlight / highlight.js token colours (minimal dark theme) — unchanged, independent of UI accent */
.hljs-keyword, .hljs-selector-tag, .hljs-built_in { color: #c792ea; }
.hljs-string, .hljs-attr { color: #c3e88d; }
.hljs-number, .hljs-literal { color: #f78c6c; }
.hljs-comment { color: #546e7a; font-style: italic; }
.hljs-function, .hljs-title { color: #82aaff; }
.hljs-type, .hljs-class { color: #ffcb6b; }
.hljs-variable, .hljs-name { color: #f07178; }
.hljs-meta { color: #89ddff; }
.hljs-operator { color: #89ddff; }

/* Links */
.note-editor a { color: var(--accent); text-decoration: underline; }
.note-editor a:hover { color: var(--accent-hover); }

/* View source/preview toggle button */
.view-toggle {
  margin-left: auto;
  padding: 6px 12px;
  background: none;
  border: none;
  border-left: 1px solid var(--border);
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 12px;
  letter-spacing: 0.03em;
  flex-shrink: 0;
}

.view-toggle:hover { color: var(--text-primary); background: var(--bg-hover); }
.view-toggle.active { color: var(--accent); }

/* Raw markdown textarea */
.raw-editor {
  field-sizing: content;  /* grows with content so outer scroll handles scrolling */
  width: 100%;
  min-height: 70vh;
  overflow: hidden;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  outline: none;
}

/* Editor toolbar (insert actions above the content) */
.note-editor-wrap { display: flex; flex-direction: column; min-height: 100%; }

.editor-toolbar {
  display: flex;
  gap: var(--space-xs);
  padding: 6px 0 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: var(--space-lg);
  flex-shrink: 0;
}

.editor-toolbar button {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  background: var(--bg-hover);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
}

.editor-toolbar button:hover { background: var(--border-strong); color: var(--text-primary); }

/* Mermaid diagram blocks — kept light regardless of theme; diagrams render best on a white canvas */
.mermaid-block {
  background: #f5f5f5;
  border-radius: 6px;
  padding: 16px;
  margin: 0.8em 0;
  overflow-x: auto;
  text-align: center;
}

.mermaid-block svg { max-width: 100%; height: auto; }
.mermaid-error { color: var(--danger); font-family: monospace; font-size: 13px; }

/* Callout blocks */
.callout {
  border-left: 4px solid var(--callout-color, var(--accent));
  background: var(--callout-bg, var(--bg-hover));
  border-radius: 0 6px 6px 0;
  padding: 10px 14px;
  margin: 0.8em 0;
}

.callout-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--callout-color, var(--accent));
  text-transform: uppercase;
  user-select: none;
}

.callout-header svg { flex-shrink: 0; }

.callout-title { font-weight: 400; text-transform: none; letter-spacing: 0; }

.callout-body > *:last-child { margin-bottom: 0; }

.callout-note  { --callout-color: #4a9eff; --callout-bg: #0d1f33; }
.callout-info  { --callout-color: #4a9eff; --callout-bg: #0d1f33; }
.callout-tip   { --callout-color: #2dd4bf; --callout-bg: #0d2420; }
.callout-warning   { --callout-color: #f0a030; --callout-bg: #271c0a; }
.callout-danger    { --callout-color: #e05050; --callout-bg: #270d0d; }
.callout-important { --callout-color: #9b59b6; --callout-bg: #1a0d27; }

/* Wiki links */
.wiki-link {
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline dotted;
  border-radius: 2px;
  padding: 0 1px;
}

.wiki-link:hover { color: var(--accent-hover); background: var(--accent-bg); }
.wiki-link-missing { color: var(--text-tertiary); text-decoration: underline dotted var(--border-strong); }
.wiki-link-missing:hover { color: var(--text-secondary); background: var(--bg-hover); }

/* Sidebar search */
.search-input {
  width: 100%;
  padding: 5px 8px;
  background: var(--bg-base);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.search-input:focus { border-color: var(--accent); }
.search-input::placeholder { color: var(--text-tertiary); }

/* Sidebar search-open button */
.search-open-btn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--text-tertiary) !important;
}

.search-open-btn kbd {
  font-size: 10px;
  color: var(--text-disabled);
  background: var(--bg-base);
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  padding: 1px 4px;
  font-family: inherit;
}

/* Full-text search modal */
.search-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
}

.search-modal {
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  width: 580px;
  max-width: calc(100vw - 40px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}

.search-modal-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border);
  color: var(--text-tertiary);
}

.search-modal-input {
  flex: 1;
  width: 100%;
  padding: 14px 0;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 16px;
  outline: none;
}

.search-modal-input::placeholder { color: var(--text-tertiary); }

.search-results {
  list-style: none;
  max-height: 400px;
  overflow-y: auto;
}

.search-result {
  padding: 10px 18px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.search-result:last-child { border-bottom: none; }
.search-result.selected { background: var(--bg-hover); }
.search-result:hover { background: var(--bg-hover); }

.search-result-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.search-result-snippet {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-result-snippet mark {
  background: transparent;
  color: var(--accent);
  font-weight: 600;
}

.search-empty {
  padding: 16px 18px;
  font-size: 13px;
  color: var(--text-tertiary);
}

/* Slash command menu */
.slash-menu {
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  min-width: 240px;
  max-height: 320px;
  overflow-y: auto;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  padding: var(--space-xs);
}

.slash-menu-item {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 7px 10px;
  background: none;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  text-align: left;
  color: var(--text-primary);
  gap: 1px;
}

.slash-menu-item.selected,
.slash-menu-item:hover { background: var(--bg-hover); }

.slash-item-title { font-size: 13px; font-weight: 500; }
.slash-item-desc { font-size: 11px; color: var(--text-tertiary); }

/* Tab close button */
.tab .tab-close {
  padding: 6px 6px 6px 2px;
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  display: flex;
  align-items: center;
}

.tab .tab-close:hover { color: var(--danger); background: none; border: none; box-shadow: none; }

/* Folder context menu */
.context-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.context-menu {
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  padding: var(--space-xs);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  min-width: 140px;
}

.context-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  padding: 6px 10px;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
}

.context-menu button:hover { background: var(--bg-hover); }

.tree-row.drag-over { background: var(--accent-bg); outline: 1px dashed var(--accent); }

/* Folder tree */
.folder-tree {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-secondary);
}

.tree-row:hover { background: var(--bg-hover); }
.tree-row.active { background: var(--accent-bg); color: var(--text-primary); }
.tree-row.selected { background: var(--bg-hover); }

.tree-toggle {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.tree-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-note .tree-label { padding-left: 16px; }

.tree-delete {
  padding: 2px 4px;
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 11px;
  opacity: 0;
  display: flex;
  align-items: center;
}

.tree-row:hover .tree-delete { opacity: 1; }
.tree-delete:hover { color: var(--danger); }

.sidebar-new-actions {
  display: flex;
  gap: 6px;
}

.sidebar-new-actions button {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}

.sidebar-error {
  margin: 4px 0 0;
  padding: 6px 8px;
  background: #270d0d;
  border: 1px solid #4a1f1f;
  border-radius: 4px;
  color: #e88;
  font-size: 12px;
}

/* Inline #tag pill */
.tag-pill {
  color: var(--accent);
  cursor: pointer;
  background: var(--accent-bg);
  border-radius: 3px;
  padding: 0 4px;
}

.tag-pill:hover { background: var(--accent-bg-hover); }
.tag-pill.active { background: rgba(126, 231, 135, 0.35); }

/* Sidebar tag list */
.tag-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.tag-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 8px;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}

.tag-item:hover { background: var(--bg-hover); }
.tag-item.active { background: var(--accent-bg); color: var(--accent); }

/* Backlinks panel */
.backlinks-panel {
  margin-top: var(--space-xl);
  padding-top: var(--space-md);
  border-top: 1px solid var(--border);
}

.backlinks-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;
}

.backlinks-toggle:hover { color: var(--text-secondary); }
.backlinks-empty { color: var(--text-tertiary); font-size: 12px; margin: 6px 0 0; }
.backlinks-list { list-style: none; margin: 6px 0 0; padding: 0; }

.backlink-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  padding: 3px 0;
  font-size: 13px;
}

.backlink-item:hover { text-decoration: underline; }

/* Ink toolbar and canvas (previously unstyled — default browser buttons) */
.ink-canvas-wrap {
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-raised);
}

.ink-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border);
}

.ink-tool {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
}

.ink-tool:hover { background: var(--border-strong); color: var(--text-primary); }
.ink-tool.active { background: var(--accent); color: var(--accent-contrast); }

.ink-toolbar input[type="color"] {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-hover);
  cursor: pointer;
}

.ink-toolbar input[type="range"] {
  width: 90px;
  accent-color: var(--accent);
}

.ink-sep {
  width: 1px;
  height: 20px;
  background: var(--border-strong);
  margin: 0 2px;
}

.ink-toolbar button:disabled { opacity: 0.35; cursor: not-allowed; }

.ink-canvas {
  background: var(--bg-base);
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0. (This step only catches accidental TSX breakage from other files referencing removed CSS class names — none are removed here, so this should pass immediately; it's a smoke check before moving on.)

- [ ] **Step 3: Manual visual check**

Run: `npm run dev` (or `npm run tauri dev`), open the app, open a workspace with at least one note.

Expected: sidebar, tab bar, editor, and modals now render on the near-black `#0d0f12`/`#111318` palette with green (`#7ee787`) active/link states instead of the old `#1a1a1a`/blue palette. The ink toolbar (insert an ink block via the editor's "Ink" button) now has a visible dark toolbar bar instead of unstyled default buttons — buttons still show plain text/glyph labels until Task 3.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat: Terminal Precision design tokens and full palette migration"
```

---

### Task 3: Ink toolbar icons — `src/ink/InkCanvas.tsx`

**Files:**
- Modify: `src/ink/InkCanvas.tsx`

**Interfaces:**
- Consumes: `.ink-tool`, `.ink-sep`, `.ink-toolbar` CSS classes from Task 2; `useInkCanvas(svgPath, width, height)` hook (unchanged, from `src/ink/useInkCanvas.ts`) returning `{ canvasRef, tool, setTool, color, setColor, size, setSize, undo, redo, canUndo, canRedo }`.
- Produces: nothing consumed by later tasks (leaf component).

- [ ] **Step 1: Replace the file contents**

```tsx
import { PenLine, Eraser, Minus, Circle, Square, MoveUpRight, Undo2, Redo2 } from 'lucide-react'
import { useInkCanvas } from './useInkCanvas'
import type { Tool } from './types'

const TOOLS: { id: Tool; label: string; Icon: typeof PenLine }[] = [
  { id: 'pen', label: 'Pen', Icon: PenLine },
  { id: 'eraser', label: 'Eraser', Icon: Eraser },
  { id: 'line', label: 'Line', Icon: Minus },
  { id: 'circle', label: 'Circle', Icon: Circle },
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'arrow', label: 'Arrow', Icon: MoveUpRight },
]

interface InkCanvasProps {
  svgPath: string
  width: number
  height: number
}

export function InkCanvas({ svgPath, width, height }: InkCanvasProps) {
  const {
    canvasRef,
    tool,
    setTool,
    color,
    setColor,
    size,
    setSize,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useInkCanvas(svgPath, width, height)

  return (
    <div className="ink-canvas-wrap">
      <div className="ink-toolbar" role="toolbar" aria-label="Drawing tools">
        {TOOLS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`ink-tool${tool === id ? ' active' : ''}`}
            onClick={() => setTool(id)}
            aria-pressed={tool === id}
            aria-label={label}
            title={label}
          >
            <Icon size={15} />
          </button>
        ))}
        <span className="ink-sep" aria-hidden />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Stroke color"
        />
        <input
          type="range"
          min={1}
          max={20}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          aria-label="Stroke size"
        />
        <span className="ink-sep" aria-hidden />
        <button className="ink-tool" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo">
          <Undo2 size={15} />
        </button>
        <button className="ink-tool" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo">
          <Redo2 size={15} />
        </button>
      </div>
      <div style={{ position: 'relative', width, height }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="ink-canvas"
          style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0.

- [ ] **Step 3: Run the existing ink test suite**

Run: `npm run test -- src/ink`

Expected: PASS — `useInkCanvas.test.ts` and `svgSerialiser.test.ts` don't touch `InkCanvas.tsx` rendering, so this is a regression check that the hook contract is untouched.

- [ ] **Step 4: Manual visual check**

In `npm run dev`, insert an ink block, confirm all six tool buttons show icons (not text), the active tool is filled green, undo/redo icons are present and disabled correctly when there's no history.

- [ ] **Step 5: Commit**

```bash
git add src/ink/InkCanvas.tsx
git commit -m "feat: icon-based ink toolbar"
```

---

### Task 4: Editor insert-toolbar icon — `src/editor/NoteEditor.tsx`

**Files:**
- Modify: `src/editor/NoteEditor.tsx`

**Interfaces:**
- Consumes: `.editor-toolbar` CSS (Task 2, now `display:flex; gap` on the button so icon + label sit inline).

- [ ] **Step 1: Add the icon import and swap the button content**

In `src/editor/NoteEditor.tsx`, add the import at the top:

```tsx
import { PenLine } from 'lucide-react'
```

Replace:

```tsx
        <button onClick={() => void insertInkBlock()} title="Insert ink block">
          ✏ Ink
        </button>
```

with:

```tsx
        <button onClick={() => void insertInkBlock()} aria-label="Insert ink block" title="Insert ink block">
          <PenLine size={14} /> Ink
        </button>
```

- [ ] **Step 2: Type-check and lint**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0.

- [ ] **Step 3: Manual visual check**

In `npm run dev`, open a note, confirm the "Ink" button in the editor's top toolbar shows a pen icon before the label and still inserts an ink block on click.

- [ ] **Step 4: Commit**

```bash
git add src/editor/NoteEditor.tsx
git commit -m "feat: icon on the editor insert-ink button"
```

---

### Task 5: Folder tree icons — `src/components/TreeNode.tsx`

**Files:**
- Modify: `src/components/TreeNode.tsx`

**Interfaces:**
- Consumes: `.tree-toggle`, `.tree-delete` CSS (Task 2, now flex-centered for icon sizing).

- [ ] **Step 1: Add imports and swap glyphs**

Add at the top of `src/components/TreeNode.tsx`:

```tsx
import { ChevronRight, ChevronDown, Trash2 } from 'lucide-react'
```

Replace the note-row delete button body:

```tsx
        <button
          className="tree-delete"
          onClick={(e) => void handleDelete(e)}
          aria-label={`Delete ${entry.name}`}
        >
          ✕
        </button>
```

with:

```tsx
        <button
          className="tree-delete"
          onClick={(e) => void handleDelete(e)}
          aria-label={`Delete ${entry.name}`}
        >
          <Trash2 size={12} />
        </button>
```

Replace the folder-row toggle span:

```tsx
        <span className="tree-toggle">{isExpanded ? '▾' : '▸'}</span>
```

with:

```tsx
        <span className="tree-toggle">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
```

- [ ] **Step 2: Type-check and lint**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0.

- [ ] **Step 3: Run the folder tree test suite**

Run: `npm run test -- src/lib/folderTree.test.ts`

Expected: PASS — this test covers tree-building logic, not `TreeNode.tsx` rendering, so it's a regression check that nothing in the data layer was touched.

- [ ] **Step 4: Manual visual check**

In `npm run dev`, expand/collapse a folder (chevron icon rotates between right/down), hover a note row and confirm the trash icon appears and deletes on click (with the existing confirm dialog).

- [ ] **Step 5: Commit**

```bash
git add src/components/TreeNode.tsx
git commit -m "feat: icon-based folder tree chevrons and delete button"
```

---

### Task 6: Folder context menu icons — `src/components/FolderContextMenu.tsx`

**Files:**
- Modify: `src/components/FolderContextMenu.tsx`

**Interfaces:**
- Consumes: `.context-menu button` CSS (Task 2, now `display:flex; gap:8px` for icon + label).

- [ ] **Step 1: Add imports and update the menu buttons**

Add at the top of `src/components/FolderContextMenu.tsx`:

```tsx
import { Pencil, Trash2 } from 'lucide-react'
```

Replace:

```tsx
        <button onClick={() => void handleRename()}>Rename</button>
        <button onClick={() => void handleDelete()}>Delete</button>
```

with:

```tsx
        <button onClick={() => void handleRename()}>
          <Pencil size={14} /> Rename
        </button>
        <button onClick={() => void handleDelete()}>
          <Trash2 size={14} /> Delete
        </button>
```

- [ ] **Step 2: Type-check and lint**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0.

- [ ] **Step 3: Manual visual check**

In `npm run dev`, right-click a folder in the sidebar, confirm the context menu shows a pencil icon next to "Rename" and a trash icon next to "Delete", and both actions still work.

- [ ] **Step 4: Commit**

```bash
git add src/components/FolderContextMenu.tsx
git commit -m "feat: icons on the folder context menu"
```

---

### Task 7: Tab close icon — `src/components/TabBar.tsx`

**Files:**
- Modify: `src/components/TabBar.tsx`

- [ ] **Step 1: Add import and swap the glyph**

Add at the top of `src/components/TabBar.tsx`:

```tsx
import { X } from 'lucide-react'
```

Replace:

```tsx
            <button className="tab-close" onClick={() => closeTab(path)} aria-label={`Close ${name}`}>
              ✕
            </button>
```

with:

```tsx
            <button className="tab-close" onClick={() => closeTab(path)} aria-label={`Close ${name}`}>
              <X size={12} />
            </button>
```

- [ ] **Step 2: Type-check and lint**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0.

- [ ] **Step 3: Manual visual check**

In `npm run dev`, open two notes as tabs, confirm each tab shows an "X" icon and closes the tab on click.

- [ ] **Step 4: Commit**

```bash
git add src/components/TabBar.tsx
git commit -m "feat: icon-based tab close button"
```

---

### Task 8: Backlinks panel toggle icon — `src/components/BacklinksPanel.tsx`

**Files:**
- Modify: `src/components/BacklinksPanel.tsx`

**Interfaces:**
- Consumes: `.backlinks-toggle` CSS (Task 2, now `display:flex; gap:4px` for icon + label).

- [ ] **Step 1: Add import and swap the glyph**

Add at the top of `src/components/BacklinksPanel.tsx`:

```tsx
import { ChevronRight, ChevronDown } from 'lucide-react'
```

Replace:

```tsx
      <button className="backlinks-toggle" onClick={() => setCollapsed((c) => !c)}>
        {collapsed ? '▸' : '▾'} Linked from ({backlinks.length})
      </button>
```

with:

```tsx
      <button className="backlinks-toggle" onClick={() => setCollapsed((c) => !c)}>
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />} Linked from ({backlinks.length})
      </button>
```

- [ ] **Step 2: Type-check and lint**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0.

- [ ] **Step 3: Manual visual check**

In `npm run dev`, open a note with backlinks, confirm the "Linked from" toggle shows a chevron icon that flips between right/down on click.

- [ ] **Step 4: Commit**

```bash
git add src/components/BacklinksPanel.tsx
git commit -m "feat: icon-based backlinks panel toggle"
```

---

### Task 9: Sidebar action icons — `src/components/Sidebar.tsx`

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `.sidebar-new-actions button`, `.search-open-btn` CSS (Task 2, now flex-centered for icon + label).

- [ ] **Step 1: Add imports and update the three buttons**

Add at the top of `src/components/Sidebar.tsx`:

```tsx
import { FilePlus, FolderPlus, Search } from 'lucide-react'
```

Replace:

```tsx
        <button onClick={() => void handleCreateNote()} disabled={!workspacePath}>
          New Note
        </button>
        <button onClick={() => void handleCreateFolder()} disabled={!workspacePath}>
          New Folder
        </button>
```

with:

```tsx
        <button onClick={() => void handleCreateNote()} disabled={!workspacePath}>
          <FilePlus size={14} /> New Note
        </button>
        <button onClick={() => void handleCreateFolder()} disabled={!workspacePath}>
          <FolderPlus size={14} /> New Folder
        </button>
```

Replace:

```tsx
      <button className="search-open-btn" onClick={onSearchOpen}>
        Search <kbd>Ctrl K</kbd>
      </button>
```

with:

```tsx
      <button className="search-open-btn" onClick={onSearchOpen}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Search size={13} /> Search
        </span>
        <kbd>Ctrl K</kbd>
      </button>
```

- [ ] **Step 2: Type-check and lint**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0.

- [ ] **Step 3: Manual visual check**

In `npm run dev`, confirm "New Note" and "New Folder" buttons show icons before their labels, and the "Search" button shows a magnifying-glass icon with the "Ctrl K" shortcut still right-aligned.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: icons on sidebar new-note/new-folder/search buttons"
```

---

### Task 10: Search modal input icon — `src/components/SearchModal.tsx`

**Files:**
- Modify: `src/components/SearchModal.tsx`

**Interfaces:**
- Consumes: `.search-modal-input-wrap` CSS class (new in Task 2) which wraps the icon + input.

- [ ] **Step 1: Add import and wrap the input**

Add at the top of `src/components/SearchModal.tsx`:

```tsx
import { Search } from 'lucide-react'
```

Replace:

```tsx
        <input
          ref={inputRef}
          className="search-modal-input"
          type="text"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
```

with:

```tsx
        <div className="search-modal-input-wrap">
          <Search size={16} />
          <input
            ref={inputRef}
            className="search-modal-input"
            type="text"
            placeholder="Search notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
```

- [ ] **Step 2: Type-check and lint**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0.

- [ ] **Step 3: Manual visual check**

In `npm run dev`, press Ctrl+K (or click the sidebar Search button), confirm the search modal shows a magnifying-glass icon to the left of the input, typing still filters results and Enter/Arrow keys still navigate.

- [ ] **Step 4: Commit**

```bash
git add src/components/SearchModal.tsx
git commit -m "feat: icon in the search modal input"
```

---

### Task 11: Import button icon — `src/components/ImportButton.tsx`

**Files:**
- Modify: `src/components/ImportButton.tsx`

- [ ] **Step 1: Add import and swap the label**

Add at the top of `src/components/ImportButton.tsx`:

```tsx
import { FileUp } from 'lucide-react'
```

Replace:

```tsx
      <button
        onClick={() => void handleImport()}
        disabled={isImporting || !workspacePath}
      >
        {isImporting ? 'Importing…' : 'Import PDF'}
      </button>
```

with:

```tsx
      <button
        onClick={() => void handleImport()}
        disabled={isImporting || !workspacePath}
      >
        <FileUp size={14} /> {isImporting ? 'Importing…' : 'Import PDF'}
      </button>
```

- [ ] **Step 2: Type-check and lint**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0.

- [ ] **Step 3: Manual visual check**

In `npm run dev`, confirm the "Import PDF" button in the sidebar shows an upload icon before its label.

- [ ] **Step 4: Commit**

```bash
git add src/components/ImportButton.tsx
git commit -m "feat: icon on the import-PDF button"
```

---

### Task 12: Callout icons — `src/editor/extensions/Callout.tsx`

**Files:**
- Modify: `src/editor/extensions/Callout.tsx`

**Interfaces:**
- Consumes: `.callout-header svg` CSS (Task 2, `flex-shrink: 0`) and the `.callout-tip` teal color already applied in Task 2.

- [ ] **Step 1: Add an icon map and render the icon**

Add at the top of `src/editor/extensions/Callout.tsx`, alongside the existing imports:

```tsx
import { Info, Lightbulb, TriangleAlert, CircleX, Star } from 'lucide-react'
```

Replace the `CALLOUT_LABEL` block and everything through the end of `CalloutView` with:

```tsx
const CALLOUT_LABEL: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Danger',
  info: 'Info',
  important: 'Important',
}

const CALLOUT_ICON: Record<string, typeof Info> = {
  note: Info,
  info: Info,
  tip: Lightbulb,
  warning: TriangleAlert,
  danger: CircleX,
  important: Star,
}

function CalloutView({ node }: ReactNodeViewProps) {
  const { calloutType, title } = node.attrs as unknown as CalloutAttrs
  const Icon = CALLOUT_ICON[calloutType] ?? Info
  return (
    <NodeViewWrapper className={`callout callout-${calloutType}`}>
      <div className="callout-header" contentEditable={false}>
        <Icon size={13} />
        <span className="callout-label">{CALLOUT_LABEL[calloutType] ?? calloutType.toUpperCase()}</span>
        {title && <span className="callout-title">{title}</span>}
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  )
}
```

Leave the rest of the file (the `Node.create` block below) unchanged.

- [ ] **Step 2: Type-check and lint**

Run: `npm run typecheck && npm run lint`

Expected: both exit 0.

- [ ] **Step 3: Manual visual check**

In `npm run dev`, create one callout of each type via the slash menu (`/note`, `/tip`, `/warning`, `/danger`, `/important`), confirm each shows its icon next to the label and that `tip` now renders in teal rather than green.

- [ ] **Step 4: Commit**

```bash
git add src/editor/extensions/Callout.tsx
git commit -m "feat: per-type icons on callout blocks, retune tip color"
```

---

### Task 13: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full type-check, lint, and unit test run**

Run: `npm run typecheck && npm run lint && npm run test`

Expected: all three exit 0 with no failures.

- [ ] **Step 2: Full manual walkthrough**

Run: `npm run tauri dev`. Walk through, in order:
1. Sidebar: open a workspace, create a note and a folder (icons on buttons), expand/collapse folders, right-click a folder (context menu icons), search via Ctrl+K, filter by tag.
2. Tabs: open 2-3 notes, close one via the X icon, toggle Source/Preview.
3. Editor: type headings (confirm sans-serif bold, tight tracking on h1/h2), insert a code block (mono font unchanged), insert each callout type via slash menu, insert a `[[wiki link]]` to another note, insert an ink block and draw with each of the six tools plus undo/redo.
4. Backlinks: open a note that's linked from another, toggle the backlinks panel.
5. Import a PDF (or confirm the button renders correctly if no test PDF is available) — icon should be present.

Expected: no console errors in the browser/webview devtools, no unstyled/default-browser-button elements remaining anywhere touched by this plan, no visual regressions (text still readable, no color contrast that makes text disappear against its background).

- [ ] **Step 3: Fix any issues found**

If Step 2 surfaces a missed selector or a contrast issue, fix it directly in `src/index.css` or the relevant component file, re-run Step 1, and commit as `fix: <description>`.

- [ ] **Step 4: Final commit (only if Step 3 produced changes)**

```bash
git add -A
git commit -m "fix: visual design system polish from final QA pass"
```
