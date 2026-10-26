# Feature Inventory

Source: docs/ROADMAP.md phase status + file listings (2026-10-22). Not all code-verified.

## Foundation

| Capability | Status | Location | Notes |
|---|---|---|---|
| Atomic autosave, save-state, external-change refresh | Implemented | notes.rs write_atomic, useNote.ts | P0 |
| Delete with recoverability (trash/undo) | Missing | notes.rs:1635 | permanent remove_file; recovery only via git if already committed. Candidate |
| Unique link resolution across same-titled notes | Missing | WikiLink.tsx:30, notes.rs rename_note_at | first-title-wins; rename rewrites all same-title links. Candidate |
| Git history of a note + restore | Implemented | NoteHistoryPanel.tsx | only for notes that still exist |

## Core Editing

| Capability | Status | Location | Notes |
|---|---|---|---|
| Find/replace, focus mode, block handle, slash cmds, [[ autocomplete | Implemented | extensions/ | |
| Wiki-links, backlinks, unlinked mentions, graph, back/forward nav | Implemented | | |
| Natural-order sort | Missing | folderTree.ts:49 | #123 |
| Sidebar multi-select | Missing | TreeNode.tsx:102 | #124 |
| Tags (flat) | Partial | #107 | no namespaces |
| Note transclusion / embed | Missing | - | not on roadmap; low priority |
| Daily/lecture note quick capture | Missing | - | templates cover most |

## Study Workflow

| Capability | Status | Location | Notes |
|---|---|---|---|
| Math, code run (Py/C/C++), Mermaid, Excalidraw diagrams, ink | Implemented | | #105 Java, #106 plotting open |
| PDF import (+ multi, Pages mode ink, split exercises) | Implemented | pdf/ | frozen |
| Spaced repetition, cloze, image/diagram/task cards, cram | Implemented | sm2.rs | #56 #63 #64 #67 open |
| Formula sheet, task view | Implemented | | #66 #68 open |
| Export PDF/print | Implemented | PrintDialog | single note |
| Markdown -> .tex export | Missing | - | ROADMAP P18 (unscoped, no issue) |

## Workspace & Sync

| Capability | Status | Location | Notes |
|---|---|---|---|
| Git auto-commit/pull/push bars, clone, sync-now | Implemented | git.rs | |
| Mobile shell (iOS/Android) | Partial | P16 | in progress |
| Web app | Missing | P17 | #24 |

## Advanced / Polish
| Capability | Status | Notes |
|---|---|---|
| Light theme | Missing | spec: dark-only by decision |
| Handwriting recognition | Missing | gated P15 |
| AI assistance | Missing | gated P10-1 |
