# null-notes — UI Hierarchy & Consistency Audit

**Date:** 2026-08-20
**Scope:** P9.5-3. Depends on P9.5-2's token set (`docs/design-tokens.md`), which this pass fixes *against* rather than re-deriving.

---

## 1. Per-screen hierarchy

One line each: what reads as primary (the reason the screen exists), secondary (supports it), tertiary (present but shouldn't compete).

| Screen | Primary | Secondary | Tertiary |
|---|---|---|---|
| Main workspace | The open note's content in the editor pane | Sidebar tree + tab bar (getting to a different note) | Toolbar icons, save-status chip, editor-status footer |
| Search modal / quick switcher | The input + result list | The search icon in the input | "No results" empty state, keyboard hints |
| Settings panel | The setting rows (actual controls) | Row labels/grouping | Close button, unit hints, small print |
| Shortcuts overlay | The shortcut list itself — it *is* the content | Grouping order | Close button |
| Graph view (connections) | The node/edge graph | Node labels | Close button, empty state |
| Task view | The open-task list | Note-title grouping headers | Close button, empty state |
| Review session | Current card's front/back text | Grade buttons (Again/Hard/Good/Easy) | Note-source caption, close button |
| Home dashboard | Section content lists (open notes/tasks/due cards) | Section headers (uppercase labels) | "View all" links, empty states |
| Formula sheet prompt | The scope input | Hint text explaining `folder:`/`tag:` syntax | Cancel/Generate actions, error text |
| Import mode dialog | The two mode options (Pages vs. Markdown) | Each option's description | The "preferred" marker, cancel |
| Template picker dialog | The template list | Per-template description | Back/Create actions, empty hint |
| Workspace picker | "Choose a folder" action | Recent-workspaces list | Subtitle copy |
| Folder context menu | The two action labels (Rename/Delete) | — (intentionally flat, no sub-hierarchy) | — |
| Slash menu | Matched command list | Command description line | — |
| Terminal pane | The live shell | Header (insert-output / kill controls) | — |

---

## 2. Consistency table

Each row: found issue → fixed or deferred, with reason. Grouped by the categories named in the roadmap task.

### Button heights / padding

| Finding | Resolution |
|---|---|
| Icon-only square buttons (`.toolbar-button`, `.ink-tool`, `.ink-pen`) are already consistent at 28×28px | No action needed |
| Six `<button>`s rendered with no CSS class at all, falling back to native OS button chrome: `FormulaSheetPrompt.tsx` Cancel/Generate, `TemplateDialog.tsx` Create | **Fixed** — added a shared `.dialog-action` class (matches `.import-mode-cancel`'s existing recipe) and applied it to all three |
| Three more buttons flagged by the same search (`ImportButton.tsx` "Import PDF"/"Import as pages"/"Cancel") turned out to be a false positive — they're DOM descendants of `<aside className="sidebar">` and already inherit `.sidebar button` styling despite their own immediate parent having no button rule | No action needed — verified by reading the component tree before "fixing" a non-bug |
| `.import-mode-cancel` had no `:hover` state at all, unlike almost every other button in the app | **Fixed** — added `.import-mode-cancel:hover` matching `.settings-reset:hover`'s pattern |
| Text-button padding varies fairly widely across dialogs (5px 10px / 5px 12px / 6px 10px / 6px 12px / 6px 14px / 7px 18px / 8px 12px) with no single scale | **Deferred** — each context (a compact conflict-bar action vs. a spacious workspace-picker row vs. a review-session grade button) has a plausible reason for its own size; collapsing all of them onto one value risks flattening real density differences between a toolbar-adjacent action and a full list row. Revisit only if a specific pair is shown to look wrong side-by-side, not as a blanket pass |

### Icon styles

| Finding | Resolution |
|---|---|
| Icon sizes cluster into three clear tiers: 15px (editor toolbar, uniform), 16px (modal close/header icons, uniform), 12-14px (sidebar/tree/inline-row icons — mixed but each within a 2px band) | **Deferred, not a bug** — these are three different contexts (a persistent toolbar vs. a modal chrome element vs. a dense tree row) and the existing spread is small and already tier-shaped rather than random. Documented here so a future addition picks the right tier instead of guessing |
| One outlier: an 8px `Circle` dot in `SaveStatus.tsx` and two 18px icons in `ImportModeDialog.tsx`/`TemplateDialog.tsx` | **Deferred** — the 8px dot is a deliberately tiny status indicator (not a clickable icon, different role entirely); the two 18px icons sit in a two-option picker where slightly larger icons are the whole visual content of the choice. Neither is unintentional drift |

### Menu/dialog padding, radius, shadow

| Finding | Resolution |
|---|---|
| `.import-mode-dialog` had no `box-shadow` at all, unlike every other modal shell (`--shadow-modal`) | **Fixed** — added `box-shadow: var(--shadow-modal);` |
| `.block-handle-menu` used a hard-coded shadow (`0 4px 16px rgba(0,0,0,0.4)`) and a literal `4px` padding instead of any token — flagged already in P9.5-2 | **Fixed** — added a fourth named elevation tier, `--shadow-compact`, holding the exact existing value (it's genuinely a smaller, different-purpose popover than the other three tiers, not drift to eliminate), and switched the literal padding to `var(--space-xs)` |
| Radius splits into two families: 8px (floating overlay dialogs — settings/search/import-mode/graph/task/review/formula/popovers) vs. 6px (attached/embedded boxes — context menu, block-handle-menu, pdf-page-block, import-fallback, ink-block-wrapper) | **Deferred, not a bug** — reviewed and found to already be a coherent two-tier pattern (dialog vs. attached-menu-or-embedded-content), not unexplained drift. Not worth forcing to one radius |
| `.import-mode-option` uses `--border` while its own `.preferred` variant uses `--border-strong` | **Deferred, not a bug** — this is a deliberate hierarchy signal (the recommended option gets the stronger border), not an inconsistency |

### Tooltip delay / implementation

| Finding | Resolution |
|---|---|
| No custom Tooltip component exists anywhere; every tooltip is the native `title=` attribute (browser-default hover delay) | **Deferred, not a bug** — 100% one mechanism is itself consistent; there's no second implementation competing with it, so there's nothing to reconcile |
| Several icon-only buttons had `aria-label` but no `title=`, so mouse users got no hover hint at all while keyboard/screen-reader users were covered: the five `.settings-panel-close` instances (Settings/Tasks/Graph/Review/Template), `TreeNode.tsx`'s rename/delete buttons, `BlockHandle.tsx`'s grip button | **Fixed** — added a matching `title=` to each, mirroring the `aria-label` text, consistent with how `InsertGroup.tsx`'s toolbar buttons already set both together |

### Input focus treatment

| Finding | Resolution |
|---|---|
| `.search-modal-input` (Search modal + quick switcher), `.raw-editor` (View Source), `.details-summary-input` (collapsible section title) all set `outline: none` with nothing replacing it — focusing them by keyboard gives no visible indicator | **Deferred** — these are large, obviously-focused text-entry surfaces (a modal that's already visually "open," a full-pane textarea, an inline title you're actively typing into) where the *cursor itself* is the focus indicator, unlike a button or row where focus is otherwise invisible. Adding `--focus-ring`'s box-shadow ring to a full-width textarea or an already-open modal's only input is a different judgment call (does it look right at that scale?) than the small controls P9.5-2 already fixed, and deserves its own look under P9.5-4's interaction pass rather than a blind mechanical add here |
| `input[type="color"]`/`input[type="range"]` in the ink toolbar, and `input[type="checkbox"]` throughout Settings/TaskView, have no explicit `:focus` rule | **Deferred** — same reasoning: these rely on the browser's native focus rendering for their control type (checkboxes and range sliders have their own OS-drawn focus affordances that a custom box-shadow would need to be checked against per-platform, not assumed) |
| `.formula-sheet-prompt-input:focus` changes `border-color` to `var(--border-strong)` — barely distinguishable from its own unfocused `var(--border)`, the weakest focus treatment in the app | **Fixed** — changed to `var(--accent)`, matching `.block-math-editor-input:focus`/`.math-editor-input:focus`'s existing pattern for the same "text input inside a raised panel" role |

### Panel borders

Covered above under menu/dialog radius; no additional findings beyond the shadow/padding items already resolved there.

### Empty-state typography

| Finding | Resolution |
|---|---|
| Font-size for "no X yet" copy varied with no rule: 14px (`.empty-state`/`.status`), 13px (`.search-empty`, `.home-empty`/`.home-status`), 12px (`.backlinks-empty`, `.outline-empty`, `.template-empty-hint`, `.sidebar-onboarding`) — all sharing the same tertiary text color | **Fixed** — introduced `--text-empty-state` (13px, matching the more common value) and applied it to all seven selectors, replacing their individual `font-size`/`line-height` declarations |
| Wording has no shared template: "No notes yet.", "No open notes.", "No notes yet — click…", "No results for…", "No notes match…", "Nothing due.", "All done for today." | **Deferred to P9.5-5** — rewriting this copy to a shared "what this is / what to do next" template is exactly P9.5-5's (Empty States) job, which also covers adding icons/actions to these surfaces. Fixing font-size here without redesigning the copy and layout together would be half the work done twice |

### Shortcut notation

| Finding | Resolution |
|---|---|
| Native OS menu accelerators use Tauri's `CmdOrCtrl+Shift+N` syntax; in-app hints (sidebar, `ShortcutsOverlay`) use `Ctrl Shift N` (space-separated, no plus sign) — same shortcuts, different textual convention depending on which surface renders them | **Deferred, not fixable here** — `CmdOrCtrl+...` is the literal accelerator string Tauri's menu API requires (`src-tauri/src/lib.rs`); the OS renders its own native "+"-joined display from that string, which is platform behavior outside this app's control. The in-app convention (space-separated, `Ctrl` even where the OS would show `⌘`) is a separate, self-consistent choice already used identically in both places it appears (`Sidebar.tsx`, `ShortcutsOverlay.tsx`) |
| `SettingsPanel.tsx` renders the terminal shortcut in a `<code>` tag while everywhere else uses `<kbd>` | **Deferred** — single occurrence, and `<code>` there is arguably describing a *typed character* (the backtick key) rather than a chord, which is a legitimately different thing from a `<kbd>` shortcut hint. Flagged here in case a future pass disagrees |
| `.search-open-btn kbd` and `.shortcuts-row kbd` had different padding (1px 4px vs. 2px 6px) with no hierarchy reason for the padding specifically (unlike their size/color difference, which *is* a deliberate primary-vs-peripheral distinction) | **Fixed** — aligned padding to `2px 6px` on both; left font-size (10px vs. 11px) and color (`--text-disabled` vs. `--text-tertiary`) different on purpose, documented inline in the CSS |
| `.note-editor kbd` (user-authored `<kbd>` inside note prose) uses a third, distinct recipe (0.8em, keycap-style bottom border) | **Deferred, not a bug** — this renders inside reading content, not UI chrome, so it's reasonably a different visual language (a "keycap" look for prose) rather than the same component as the other two |

### Interaction feel (panel-open / tab-switch / dialog / drag-drop)

| Finding | Resolution |
|---|---|
| Only two `transition:` rules exist in the entire stylesheet (`.details-chevron`, `.callout.cross-ref-target`); every dialog/panel/menu open-close, tab switch, and hover/active color swap is an instant cut — no `@keyframes`, no animation library dependency | **Deferred to P9.5-4** — this is that task's literal subject ("Interaction & micro-interaction polish... Add restrained feedback where currently silent"). Recorded here as the factual baseline P9.5-4 should work from, not fixed in this pass — this table's job was to find and name it, not to design the motion language |

---

## Net changes from this pass

- `.dialog-action` — new shared button class for plain dialog actions
- `.import-mode-cancel:hover` — added, was missing
- `.import-mode-dialog` — gained `box-shadow: var(--shadow-modal)`
- `--shadow-compact` — new token, applied to `.block-handle-menu` (replacing its literal shadow and literal padding)
- `--text-empty-state` — new token, applied to all seven empty-state/status selectors
- `.formula-sheet-prompt-input:focus` — border-color corrected to `var(--accent)`
- `.context-menu button.danger` — new rule, applied to the folder context menu's Delete action (was the only destructive menu action in the app not visually marked as such — `.block-handle-menu-item.danger` already existed elsewhere)
- `title=` added alongside existing `aria-label` on: five `.settings-panel-close` buttons, `TreeNode.tsx` rename/delete, `BlockHandle.tsx` grip
- `.search-open-btn kbd` padding aligned to `.shortcuts-row kbd`'s `2px 6px`

Verified with `npm run typecheck` (clean), `npm test -- --run` (528/528 passing), and a dev-server screenshot of the workspace picker showing no visual regression.
