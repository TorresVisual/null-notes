# Remove Scaffold Project Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Delete the "Scaffold Project Notes" feature (P7-3, `File > Scaffold Project Notes`, writes `notes/Architecture.md`/`Meeting.md`/`Research.md`/`Todo.md` into an already-open code-repo workspace) end to end — Rust command, menu item, its tests, the frontend hook and API binding, and the `Layout.tsx` wiring — and record the removal in `docs/ROADMAP.md`/`TODO.md` rather than leaving them claiming a feature that no longer exists.

**Architecture:** This supersedes `docs/plans/arrival-moment.md`, which proposed surfacing this same feature more prominently on the empty-workspace screen. Product direction changed: the feature is old, narrow (useful only inside a code repo a user already has open), and manual note creation is not enough of a burden to justify keeping — let alone promoting — it. Nothing else in the app reads `scaffold_project_notes`/`useScaffoldProjectNotes`/`PROJECT_NOTE_TITLES`; the only other seeding feature in the codebase, `seed_default_templates_at` (the "Add the exercise-sheet starter template" button in `TemplateDialog`), is a separate, unrelated mechanism and is untouched by this plan.

**Tech Stack:** Rust (Tauri commands, `cargo test`), React 19 + TypeScript, Vitest.

**Spec:** `docs/specs/product-completion-pass-design.md` (§ WS3 — Arrival moment, superseded section)

## Global Constraints

- Do not touch `seed_default_templates_at`, `DEFAULT_TEMPLATES`, `EXERCISE_SHEET_TEMPLATE`, or anything in `TemplateDialog.tsx` — a different, still-wanted feature that happens to share the "top up, don't overwrite" pattern in a code comment, nothing more.
- This plan runs **before** `docs/plans/overlay-exclusivity.md` — that plan's `Layout.test.tsx` mock harness is written assuming `useScaffoldProjectNotes` no longer exists (see the note added to that plan's Task 2).
- Record the removal in `docs/ROADMAP.md` and `TODO.md` rather than deleting their P7-3 history outright — this project's own convention for a reversed decision is a strikethrough plus a dated explanation (see `TODO.md`'s existing "~~Re-derive P5, P6 and P9 from real use~~ — Superseded" entry), not silently rewriting the record.

---

### Task 1: Remove the Rust command, menu item, and tests

**Files:**
- Modify: `src-tauri/src/commands/notes.rs:975-1010` (delete), `src-tauri/src/commands/notes.rs:1022-1047` (delete), `src-tauri/src/commands/notes.rs:2227-2308` (delete)
- Modify: `src-tauri/src/lib.rs:43-51` (delete the menu item), `src-tauri/src/lib.rs:249` (delete the `invoke_handler` registration)

- [ ] **Step 1: Establish the baseline**

Run: `cd src-tauri && cargo test scaffold`
Expected: 4 tests pass (`test_scaffold_creates_the_four_starter_notes_inside_notes`, `test_scaffold_touches_nothing_outside_the_notes_folder`, `test_scaffold_tops_up_without_overwriting_an_existing_note`, `test_scaffold_run_twice_creates_nothing_the_second_time`) — confirms the removal target before touching anything.

- [ ] **Step 2: Delete the command and its tests**

In `src-tauri/src/commands/notes.rs`, delete these three ranges in full:

1. Lines 975-1010 — the `PROJECT_NOTE_TITLES` const, the `PROJECT_NOTES_DIR` const, and `scaffold_project_notes_at` (its own doc comments included).
2. Lines 1022-1047 — the `#[tauri::command] pub async fn scaffold_project_notes` wrapper.
3. Lines 2227-2308 — the four `#[tokio::test]` functions and their leading comments (bounded above by `// P7-3. Opt-in only...` and below by the closing brace of `test_scaffold_run_twice_creates_nothing_the_second_time`; `test_list_templates_at_missing_folder_is_an_empty_list_not_an_error` immediately after is unrelated and stays).

Leave `split_into_tasks` (lines 1017-1020, between the first two deleted ranges) and everything from `EXERCISE_SHEET_TEMPLATE` onward (line 1049+) untouched.

- [ ] **Step 3: Delete the menu item**

In `src-tauri/src/lib.rs`, delete lines 43-51 in full — the leading comment (`// A menu item and nothing else: scaffolding is on request only...`) and the `MenuItem::with_id(handle, "scaffold-notes", "Scaffold Project Notes", true, None::<&str>)?,` entry. The `&PredefinedMenuItem::separator(handle)?,` immediately before it (line 42's sibling) and the one immediately after (line 52) both stay — File's menu keeps one separator between "Open Workspace…" and "Import PDF" (the next surviving entry), not two in a row, so confirm only one separator remains once this entry is gone.

- [ ] **Step 4: Delete the command registration**

In the same file, delete line 249 — `commands::notes::scaffold_project_notes,` — from the `invoke_handler`'s `generate_handler!` list.

- [ ] **Step 5: Build and test**

Run: `cd src-tauri && cargo build`
Expected: compiles clean — no dangling reference to `scaffold_project_notes`, `scaffold_project_notes_at`, `PROJECT_NOTE_TITLES`, or `PROJECT_NOTES_DIR` anywhere else in the crate.

Run: `cd src-tauri && cargo test`
Expected: full suite passes, four fewer tests than baseline.

Run: `cd src-tauri && cargo clippy -- -D warnings`
Expected: clean — catches any import that's now unused as a side effect of the deletion (e.g. if `Uuid` or `now_ms` were only reached through the deleted command; check the diff before committing if clippy flags either).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/notes.rs src-tauri/src/lib.rs
git commit -m "remove: delete Scaffold Project Notes (P7-3) — narrow, low-value, easy to do by hand"
```

---

### Task 2: Remove the frontend hook, API binding, and `Layout.tsx` wiring

**Files:**
- Delete: `src/hooks/useScaffoldProjectNotes.ts`
- Modify: `src/lib/tauri.ts:42-43` (delete)
- Modify: `src/components/Layout.tsx` (import, hook call, `runCommand` case, `useCallback` dep)

- [ ] **Step 1: Delete the hook**

Delete `src/hooks/useScaffoldProjectNotes.ts` entirely. (No test file exists for it — confirmed via `Glob src/hooks/useScaffoldProjectNotes.test.ts` before deleting, in case one was added since this plan was written.)

- [ ] **Step 2: Delete the API binding**

In `src/lib/tauri.ts`, delete lines 42-43:

```ts
    scaffoldProjectNotes: (workspace: string) =>
      invoke<NoteMetadata[]>('scaffold_project_notes', { workspace }),
```

- [ ] **Step 3: Remove the `Layout.tsx` wiring**

In `src/components/Layout.tsx`:

Delete the import:

```ts
import { useScaffoldProjectNotes } from '../hooks/useScaffoldProjectNotes'
```

Delete the hook call (alongside the other `useCreate*` calls):

```ts
  const scaffoldProjectNotes = useScaffoldProjectNotes()
```

Delete the `'scaffold-notes'` case from `runCommand`'s switch:

```ts
        case 'scaffold-notes': {
          if (!workspacePath) break
          // Confirmed because it writes into a folder the user may not think
          // of as theirs to write in — this is the one command that can put
          // files inside somebody's source repository.
          if (!(await confirm(`Create a notes/ folder with starter notes in ${workspacePath}?`))) break
          const created = await scaffoldProjectNotes()
          if (created === 0) await message('notes/ already has all four starter notes — nothing to add.')
          break
        }
```

Remove `scaffoldProjectNotes` from `runCommand`'s `useCallback` dependency array. Check whether `confirm`/`message` (from `@tauri-apps/plugin-dialog`) are still used elsewhere in the file before removing their import — they are: `runCommand`'s Git-related cases and `SettingsPanel` usage elsewhere in the app use `confirm`/`message` too, but confirm this file specifically still needs the import by checking for other call sites of `confirm(`/`message(` in `Layout.tsx` after this deletion; if none remain, remove the now-unused import.

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck`
Expected: no errors — confirms no remaining reference to `useScaffoldProjectNotes` or `api.notes.scaffoldProjectNotes`.

Run: `npm test -- --run`
Expected: full suite passes.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useScaffoldProjectNotes.ts src/lib/tauri.ts src/components/Layout.tsx
git commit -m "remove: delete the frontend half of Scaffold Project Notes"
```

---

### Task 3: Record the removal in the roadmap and TODO

**Files:**
- Modify: `docs/ROADMAP.md` (the P7-3 entry, around line 822)
- Modify: `TODO.md` (the P7-3 entry, around lines 436-438)

Not a code task — no test/build step. This is bookkeeping so the two documents stop describing a feature that no longer ships, following the project's own convention for a reversed decision (strikethrough plus a dated explanation, not silent deletion of the historical record — see `TODO.md`'s existing "~~Re-derive P5, P6 and P9 from real use~~" entry).

- [ ] **Step 1: Annotate `docs/ROADMAP.md`**

Find the P7-3 bullet (near line 822):

```
- Optionally scaffold a `notes/` folder (Architecture / Meeting / Research / Todo) on request — **on request only**, never automatically, and never writing into source folders.
```

Change to:

```
- ~~Optionally scaffold a `notes/` folder (Architecture / Meeting / Research / Todo) on request — **on request only**, never automatically, and never writing into source folders.~~ *Removed 2026-08-25 — narrow (useful only inside an already-open code repo), old, and manual note creation was never enough of a burden to justify the feature, let alone promoting it further.*
```

- [ ] **Step 2: Annotate `TODO.md`**

Find the P7-3 checklist item (line 436):

```
- [x] Opt-in scaffold of `notes/` (Architecture / Meeting / Research / Todo) — **never automatic**, never writes into source folders
```

Change to:

```
- [x] ~~Opt-in scaffold of `notes/` (Architecture / Meeting / Research / Todo) — **never automatic**, never writes into source folders~~ — *removed 2026-08-25, see below*
```

Find the explanatory note directly below it (line 438, starting `> Reachable from **File > Scaffold Project Notes**...`) and replace its whole paragraph with:

```
> *Removed 2026-08-25.* Old, narrow — useful only inside a code repo the user already has open — and manual note creation was never enough of a burden to justify keeping it, let alone the "surface it more prominently" idea a later product-completion pass considered and dropped for the same reason. `scaffold_project_notes`/`scaffold_project_notes_at`, its four tests, the `File > Scaffold Project Notes` menu item, and the frontend hook are all deleted, not just hidden.
```

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md TODO.md
git commit -m "docs: record removal of Scaffold Project Notes in the roadmap and TODO"
```
