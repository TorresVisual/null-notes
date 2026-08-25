# Product completion pass

## Problem

A fresh product audit (`docs/plans/../` — see the "The Last Five Percent" review, not itself a roadmap item) found that null-notes is feature-complete but not yet product-complete: the visible gaps are concentrated in a few specific moments rather than spread across missing features. This spec covers four independently-shippable fixes drawn from that audit, plus one unrelated deletion (WS3, superseded — see below) that surfaced during planning. Each is scoped to produce working, testable software on its own — none depend on the others except the stated execution order, and none require the shared-component-library refactor the audit explicitly deferred.

A fifth workstream from the audit (surfacing Git-backed auto-commit history as a user-facing "note history" feature) is deliberately **not** in this spec — it's underspecified enough that writing concrete tasks for it now would mean placeholders. It needs its own brainstorming pass first.

Two claims from the audit's first draft did not survive verification against the running app and real code, and are corrected here rather than carried forward:

- The sidebar's "Settings" label is **not** an unstyled/off-palette blue. `getComputedStyle` on all three `.search-open-btn` buttons (Home, Search, Settings) returns the identical `rgb(86, 95, 107)` (`--text-tertiary`). No fix needed; dropped from scope.
- The scaffold-notes generator (`useScaffoldProjectNotes`) cannot be offered on `WorkspacePicker` as first proposed — it requires an already-open `workspacePath` and writes into that workspace. It cannot run before a folder is chosen. The corrected design (WS3 below) offers it on the empty-workspace screen instead, where a workspace path already exists.

## WS1 — Overlay exclusivity

**Bug, confirmed live:** `SettingsPanel` has no `Escape` handling at all (no `onKeyDown`, no focused input to catch it) and `Layout.tsx` has no overlay-level `Escape` listener either — pressing `Escape` while Settings is open does nothing. Pressing `?` immediately after opens `ShortcutsOverlay` stacked on top of the still-mounted Settings panel, because the two are independent booleans (`settingsOpen`, `shortcutsOpen` — `Layout.tsx:80-88`) with no shared exclusivity rule.

**Design:** Replace the nine independent `useState<boolean>` overlay flags in `Layout.tsx` (`searchOpen`, `switcherOpen`, `settingsOpen`, `shortcutsOpen`, `templateDialogOpen`, `graphOpen`, `taskViewOpen`, `reviewOpen`, `formulaSheetOpen`) with a single hook, `useOverlayManager` (`src/hooks/useOverlayManager.ts`), holding one `activeOverlay: OverlayKind | null` value. Opening any overlay replaces whichever was active — exclusivity by construction, not by a rule someone has to remember to enforce. The hook owns a single `window` `keydown` listener for `Escape` that closes whichever overlay is active, replacing each overlay's own ad hoc handling.

`OverlayKind` is a closed union covering exactly the nine `search-overlay`-backdrop-style modals: `'search' | 'switcher' | 'settings' | 'shortcuts' | 'template' | 'graph' | 'task' | 'review' | 'formulaSheet'`.

**Explicitly out of scope**, and why each is a deliberate exclusion, not an oversight:
- `PromptDialog` — a separate, already-exclusive-by-construction mechanism (`store/promptDialog.ts` holds one pending request/resolve pair at a time). Folding it into `OverlayKind` would mean two competing "what's currently open" sources of truth for no behavior change.
- `TerminalPane`, `OutlinePanel` — docked panels with their own show/hide state, not modal dialogs with a backdrop. They can legitimately coexist with an open overlay.
- `ConflictBar`, `GitDivergedBar`, `GitAutoCommitPrompt` — inline banners in the main content area, not `.search-overlay`-backdrop dialogs.

`SearchModal` and `QuickSwitcher` currently each implement their own `Escape` branch inside a component-level `onKeyDown` (bound to the modal div, catching `Escape` only while a child has focus). Once the hook's `window`-level listener owns `Escape` universally, these branches become dead weight — removed as part of this task, not left to bit-rot as an unreachable second code path.

## WS2 — Acknowledgment layer

**Design — toasts:** A new store, `src/store/toast.ts`, following the exact shape `store/promptDialog.ts` already establishes for "a plain function anywhere in the app resolves through a Zustand store nobody else needs to know exists": `showToast(message: string)` pushes onto a list; each entry self-dismisses via a `setTimeout` set at push time (not recomputed in a component effect — recomputing per-render would reset every existing toast's timer whenever a new one arrives). A new always-mounted component, `src/components/ToastStack.tsx`, renders the list — same pattern as `<PromptDialog />` in `Layout.tsx:314`, unconditionally present, self-manages visibility from its own store.

CSS: `.toast` joins the existing shared `surface-in` animation selector list (`index.css:147-151`) rather than defining a second entrance animation — one motion language, not two. `prefers-reduced-motion` coverage is automatic (the existing blanket `*` rule at `index.css:133-135`), no extra work needed.

**Call sites, and why only these two:** `ImportButton.tsx`'s successful PDF import (after `expandFolder(folder)`, `ImportButton.tsx:118`) and `TemplateDialog.tsx`'s successful note creation (`TemplateDialog.tsx:66-67`) — both are actions the user directly triggered and waited on, with no other acknowledgment today. Git auto-commit is deliberately **not** wired to a toast in this pass: it already has a passive acknowledgment (`GitCommitStatus`'s tab-bar chip, 4-second display), and unlike import/template creation it's a background action the user didn't just click — stacking an intrusive toast on top of an already-adequate passive signal is more noise than signal. Revisit only if a future pass finds users missing the chip.

**Design — loading affordances:**

*Workspace open* has zero indicator today (`useWorkspace.ts`'s `openWorkspaceAt` runs `api.notes.scan` + `api.workspace.load` in parallel with nothing shown). Add `folderLoading: boolean` to `useWorkspaceStore` (`store/workspace.ts`, alongside the existing `folderError` field at line 43-44 / 92 / 166), set `true` at the start of `openWorkspaceAt` and `false` on both the early-return catch path and at the end of the happy path. Consuming components — `WorkspacePicker`'s "Choose a folder…" button and recents list, `Sidebar`'s "Open Workspace" button — disable themselves and swap their label to "Opening…" while `folderLoading` is true, mirroring `ImportButton`'s own already-established `{busy ? 'Importing…' : 'Import PDF'}` pattern exactly (`ImportButton.tsx:147-148`) rather than inventing a second loading-label convention.

*Note open* already shows text (`Layout.tsx:358`, `<p className="status">Loading…</p>`) but no spinner. Add a small spinning `Loader2` icon (lucide-react, already the app's only icon set) next to the text, via a new `.spin` class (`@keyframes spin { to { transform: rotate(360deg); } }`, `animation: spin 0.8s linear infinite`) — covered by the same blanket reduced-motion rule as the toast animation.

## WS3 — Arrival moment — **superseded, see "Remove Scaffold Project Notes" below**

The original WS3 design (preserved here for the record) proposed surfacing `useScaffoldProjectNotes` as a second, visible action on the empty-workspace screen, having already corrected the audit's initial claim that it belonged on `WorkspacePicker`. Before that plan was executed, product direction changed: the scaffold feature itself — old, narrow (useful only inside a code repo already open), and easy enough to do by hand — isn't worth keeping, let alone promoting further. `docs/plans/arrival-moment.md` is removed; `docs/plans/remove-scaffold-notes.md` replaces it.

## Remove Scaffold Project Notes

Deletes the feature end to end rather than leaving it hidden: the Rust command (`scaffold_project_notes`/`scaffold_project_notes_at`, `src-tauri/src/commands/notes.rs`), its four tests, the `File > Scaffold Project Notes` menu item (`src-tauri/src/lib.rs`), the frontend hook (`src/hooks/useScaffoldProjectNotes.ts`), the API binding (`src/lib/tauri.ts`), and the `Layout.tsx` wiring (`runCommand`'s `'scaffold-notes'` case). `docs/ROADMAP.md` and `TODO.md`'s P7-3 entries are annotated with a strikethrough and a dated explanation — this project's existing convention for a reversed decision — rather than silently rewritten. Full detail in `docs/plans/remove-scaffold-notes.md`.

**Execution order:** this runs *before* WS1 (overlay exclusivity) — WS1's `Layout.test.tsx` mock harness is written assuming `useScaffoldProjectNotes` is already gone, not mocking a hook that's about to be deleted out from under it.

**Explicitly untouched:** `seed_default_templates_at`, `DEFAULT_TEMPLATES`, and `TemplateDialog.tsx`'s "Add the exercise-sheet starter template" button — a different, still-wanted feature that only shares a code comment ("same top up, don't replace rule") with the deleted one.

## WS4 — Home narrative

`HomeView.tsx` already computes everything a one-line summary needs (`tasks.length`, `dueCards.length`, the derived `gitStatus` string) but never synthesizes them — five section headers, no framing. Add a pure function, `buildHomeSummary`, and one line of JSX rendering its output above the section grid.

**`buildHomeSummary(input: { taskCount: number; dueCount: number; gitStatus: string | null }): string`** — lives in `src/lib/homeSummary.ts` (a plain function, not a component, so it's unit-testable without rendering). Rules:
- One clause per non-zero count: `"N task(s) open"`, `"N card(s) due"` (correct singular/plural).
- A Git clause only when there's something to say — `gitStatus !== null && gitStatus !== 'Up to date'` — used as-is: every non-clean value `HomeView.tsx` derives (`"N unpushed"`, `"N ahead, M behind"`) already starts with a digit, so it reads correctly mid-sentence with no case transformation needed.
- Clauses join with `", "`, end with `"."`.
- Nothing to report: `"Nothing outstanding right now."` when not a Git repo, `"Nothing outstanding — everything's up to date."` when it is and it's clean. Two distinct sentences, not one, because "everything's up to date" would be a false claim about Git for a workspace that isn't a repository at all.

Rendered as `<p className="home-summary">{buildHomeSummary({...})}</p>` immediately inside `.home-view`, before the section grid (`HomeView.tsx:64`, wrapping change — `.home-view` currently *is* the grid container per `index.css:2708-2713`, so this needs a wrapping element change, detailed in the plan). New CSS rule `.home-summary` placed next to the existing `.home-section` block (`index.css:2715` onward).

## Out of scope

- The shared Button/Dialog/Input component extraction the audit flagged as real but separate debt — none of these tasks introduce or require it.
- Workstream 5 (visible Git history as a user feature) — needs a brainstorming pass, not a plan, first.
- Any change to `WorkspacePicker.tsx` — see WS3's history above; superseded before it mattered.
- A toast call site for Git auto-commit (see WS2's rationale above).
- `seed_default_templates_at`/`DEFAULT_TEMPLATES`/`TemplateDialog.tsx` — untouched by the scaffold-notes removal; a separate feature.

## Execution order

`remove-scaffold-notes` → `overlay-exclusivity` → `toast-acknowledgment-layer` → `home-narrative`. The first two have a real dependency (see "Remove Scaffold Project Notes" above); the rest is independent and could run in any order.
