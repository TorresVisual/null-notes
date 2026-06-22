# null-notes — Tech Stack Design

**Date:** 2026-06-22
**Scope:** v1 (PDF pipeline + ink support), v2 noted where relevant

---

## Overview

A Markdown-first desktop note-taking application for CS students. WYSIWYG editing, inline handwriting, and a PDF import pipeline that converts exercise sheets into structured solution templates. Desktop-primary (Windows, Lenovo stylus), browser support as a free byproduct of the web frontend.

---

## Release Scope

**v1**
- WYSIWYG markdown editor (TipTap)
- Inline ink blocks with pen, eraser, and shape tools
- PDF import pipeline: OCR → equation recovery → structured markdown

**v2**
- Integrated AI terminal (claude against open .md file)
- In-editor code execution (Python, C++)

---

## Stack

| Layer | Choice | Reason |
|---|---|---|
| Desktop shell | Tauri 2 | Small binary, WebView2 on Windows, Rust backend |
| Backend | Rust | PDF processing, OCR orchestration, file I/O |
| Frontend | React + TypeScript | Component model fits TipTap node architecture |
| Editor | TipTap (ProseMirror) | WYSIWYG-first, custom block nodes, React renderers |
| Ink canvas | Canvas API + perfect-freehand | 60fps drawing, pressure/tilt via Pointer Events |
| PDF rendering | pdfium-render (Rust) | Renders PDF pages to images for OCR |
| Text OCR | Tesseract | Local, offline, no install size concern |
| Equation OCR | pix2tex | Local ML model for LaTeX recovery from images (~500MB bundled model weight) |
| Storage | Plain .md files + SQLite | .md is source of truth; SQLite is a rebuildable index |
| Sync | None in v1 (Git or Syncthing manually) | Avoids cloud dependency |

---

## Architecture

### Desktop Shell (Tauri)

Tauri exposes typed Rust commands to the frontend via IPC. The frontend never touches the filesystem directly — all file reads, writes, and pipeline operations go through Tauri commands.

```
Frontend (React/WebView2)
        ↕  Tauri IPC commands
Rust backend
        ↕  filesystem / child processes
.md files, .ink/ SVGs, SQLite, Tesseract, pix2tex
```

Browser deployment: the React frontend is a standard web app. Tauri IPC calls are wrapped behind a thin adapter interface so the frontend is unaware of the host. In a browser context, file access would use the File System Access API. This is a future concern — no browser adapter is in v1 scope.

---

### Editor (TipTap)

TipTap runs in WYSIWYG mode — markdown syntax is hidden as the user types, content renders inline. Custom node types extend the document model:

- `InkBlock` — renders a drawing canvas or static SVG
- `ExerciseBlock` — wraps extracted PDF exercises with a Solution section
- `MathBlock` — inline and block KaTeX
- `CodeBlock` — syntax highlighted, with "Open in IDE" button (v2: execution)
- `CalloutBlock`, `ProofBlock`, `AlgorithmBlock`

TipTap JSON is the in-memory document format. On save, a serializer converts it to clean `.md`. On open, the `.md` is parsed back to TipTap JSON. Custom node directives (`:::ink{src=...}`) survive the round-trip.

---

### Ink Subsystem

#### Drawing pipeline

```
Stylus → PointerEvent
  ↓
pointerType === "pen" check
  button === 5  → eraser mode
  default       → draw mode
  ↓
getCoalescedEvents()          ← captures all intermediate points per frame
  ↓
perfect-freehand              ← smooths stroke, applies pressure curve
  ↓
Canvas (offscreen)            ← renders at 60fps
  ↓
pointerup                     → commit stroke to SVG <path>
  ↓
.ink/sketch-N.svg             ← sidecar file updated
```

#### Eraser

- Physical eraser end detected via `button === 5` on `pointerdown` — automatic, no mode switch needed
- **v1:** stroke-level erase (entire stroke deleted on contact)
- **v2:** segment-level erase (splits path at intersection)
- All erase actions pushed to undo/redo stack

#### Shape tools

Toolbar: `[ Pen ] [ Eraser ] [ Line ] [ Circle ] [ Rect ] [ Arrow ] | [ Undo ] [ Redo ]`

- Drag to create; live preview during drag
- Committed on `pointerup` as native SVG primitives (`<line>`, `<circle>`, `<rect>`) — not freehand paths
- Same undo/redo stack as strokes

#### Palm rejection

`pointerType === "pen"` filter — touch and mouse events are ignored while in ink mode. User toggles ink mode via toolbar or keyboard shortcut.

#### Storage

Strokes are stored as individual `<path>` elements (not merged) so the eraser can target them without geometry parsing.

```
Lecture 7.md
Lecture 7.ink/
  sketch-1.svg    ← individual strokes as separate <path> elements
  sketch-2.svg
```

The `InkBlock` TipTap node stores:
- `src` — relative path to sidecar SVG
- `width`, `height` — canvas dimensions
- `locked` — static render when true (view mode)

---

### PDF Pipeline

Runs entirely in Rust, async, triggered by drag-and-drop or file open. Progress streamed to frontend via Tauri events.

```
PDF file
  ↓
pdfium-render     → renders each page to image
  ↓
Tesseract         → text + bounding boxes
  ↓
pix2tex           → equation regions → LaTeX
  ↓
Rust parser       → merges text + equations, detects exercise boundaries
  ↓
TipTap JSON       → sent to frontend as ExerciseBlock nodes
  ↓
.md file          → serialized on first save
```

**Exercise detection:** heuristic pattern matching on numbered prefixes (`1.`, `Task 1`, `Exercise 3`), section breaks, and indentation. Covers ~80% of standard university sheets. Users can split/merge blocks manually.

**Output template:**

```md
# Exercise Sheet 4

## Task 1
[extracted content]

### Solution

---

## Task 2
...
```

**Performance target:** 20-page sheet under 10 seconds locally.

**Accuracy caveat:** pix2tex output is editable — it is a time-saver, not a guarantee. Scanned or handwritten equations have lower accuracy than typeset PDFs.

---

### Data & File Structure

```
~/null-notes/
├── Analysis II/                    ← workspace folder
│   ├── Lecture 7.md
│   ├── Lecture 7.ink/
│   │   └── sketch-1.svg
│   ├── Exercise Sheet 4.md
│   └── .workspace.json            ← open tabs, pane layout, scroll positions
└── .null-notes/
    └── index.db                   ← SQLite: search index, tags, backlinks
```

**SQLite** stores only derived/index data. Deleting `index.db` and re-scanning the filesystem fully reconstructs it. Notes are never locked in.

**Workspace state** (`.workspace.json`) persists per-workspace layout so reopening a subject restores the exact session state.

---

## What Is Explicitly Out of v1

- Cloud sync (use Git or Syncthing manually)
- AI terminal
- Code execution
- Segment-level eraser
- Hold-to-snap shape recognition
- Mobile / tablet support
- Collaboration
