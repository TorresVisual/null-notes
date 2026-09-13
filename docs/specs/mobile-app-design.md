# Mobile app (issue #23)

## Problem

`docs/ROADMAP.md` cut mobile with a one-line reasoning: *"Desktop + stylus is the whole point; a second platform is a different product."* The maintainer reopened it 2026-09-09 (`TorresVisual/null-notes#23`) without re-scoping it — the roadmap entry just says "reconsidered... not yet scoped or designed." This is that scoping pass.

The sibling issue, #24 (web app, no local files, fully git-backed), was reopened the same day for the same underlying reason. It is explicitly **out of scope here** — treated as a separate future brainstorm, not because the two are unrelated, but because solving both at once risks a design that serves neither well. Nothing in this spec should assume a web client exists.

## Decision: what "mobile app" means

Full editor parity, not a reader or a quick-capture companion. The reopened issue is a reversal of "different product," so the bar is the same bar desktop already clears: create and edit notes, ink, import PDFs, review flashcards — on a phone. Two features are structurally exempt from that bar (see below), not by scope choice but because the OS forbids the mechanism.

**Platform:** iOS first, via Tauri 2's mobile target added to the *existing* Tauri project. Same Rust core (`src-tauri/`), same React/TipTap frontend (`src/`) — this is a new build target, not a new codebase. Android is a later, separate pass once the iOS port has proven the approach; nothing in this spec blocks on it, and nothing here should be built as an iOS/Android abstraction speculatively (YAGNI — add the seam when Android is actually next).

## Storage & sync: Git-only workspace

Desktop's storage boundary (CLAUDE.md, "The storage boundary") is a plain folder of `.md` files, optionally Git-backed. iOS has no equivalent of "pick any folder on disk" — the app sandbox doesn't expose one, and Tauri's folder-picker dialog has nothing to bind to on iOS.

Mobile workspaces are **Git-only**: there is no non-Git mobile workspace mode.

- First launch: clone a remote into the app's sandboxed container (`Documents/` under the app's iOS sandbox — durable, included in iCloud/iTunes device backups, invisible to the Files app unless the app opts in, which it doesn't need to for v1).
- `index.db` stays out of the workspace per the existing storage-boundary rule (rebuildable, not merged) — same SQLite index, same app-data-dir placement, now inside the iOS app container instead of the Windows app-data dir.
- A note that exists only uncommitted-and-unpushed on desktop is invisible on mobile until it's pushed — identical to how two desktop machines behave today. This is not a new limitation mobile introduces; it's the existing model applied to a second device.

### Why desktop's git.rs can't be reused

`src-tauri/src/commands/git.rs` implements all of this today (repo-mode detection, auto-commit, push, fetch/pull, rebase-onto-remote, note-history browsing, unsafe-state detection — 12 operations) by shelling out to the `git` CLI via `std::process::Command`. That's a deliberate desktop choice: it inherits the user's credential helpers, SSH agent, commit signing and `.gitconfig` for free.

iOS forbids spawning child processes entirely — the same sandbox restriction that already rules out the Run button (Feature cuts, below) rules out `git.rs` wholesale. There is no `git` binary to shell out to, and no mechanism to shell out with even if there were one. This was missed in the first pass of this spec (which assumed the layer could be "reused as-is") and is corrected here: **mobile needs its own in-process git implementation**, not a port of `git.rs`.

### Mobile git module

A new module, `src-tauri/src/commands/git_mobile.rs` (mobile build target only — desktop keeps `git.rs` unchanged), built on **gix** (gitoxide): pure Rust, no C library to cross-compile for iOS, which avoids stacking a second cross-compilation unknown on top of the pdfium one below.

- **Scope: full parity with `git.rs`'s 12 operations** — repo-mode/prior-automation detection, unsafe-repo-state, auto-commit, push, fetch/pull with fast-forward check, rebase-onto-remote, note-history listing and reading a note at a past commit, clone. Each is reimplemented against `gix`'s API rather than shelled out; the Tauri command names and their request/response shapes (`RepoMode`, `UnsafeRepoState`, `PullOutcome`, `RebaseOutcome`, etc. from `src-tauri/src/models.rs`) stay the same so the frontend (`src/lib/tauri.ts`, `useWorkspaceStore`) doesn't need mobile-specific branches — only the Rust implementation behind each command differs per target.
- **Exception:** `list_own_github_repos` (the "pick from your GitHub repos" convenience in desktop's clone flow) shells out to the `gh` CLI, which has the same no-subprocess problem and no in-process equivalent designed here. Mobile onboarding skips the picker — the user pastes a repository URL directly (see Onboarding below). Revisit only if manual URL entry proves to be real friction.

### Credentials

Desktop's git.rs never handles credentials itself — the real `git` CLI does, via the user's existing SSH agent/credential helpers. `gix` has no such inheritance; mobile needs an explicit credential mechanism.

**Mobile uses HTTPS + a personal access token**, entered once during onboarding and stored in the iOS Keychain (via a Tauri plugin or direct `Security` framework binding — not `settings.json`, which is a plain file and not an appropriate place for a secret). Every `gix` fetch/push authenticates with that token over HTTPS. No SSH key generation, no agent, no deploy-key registration flow — the simplest mechanism that works for a single personal remote, matching the "friction and visibility over containment" posture the rest of this codebase already applies to trust boundaries (`docs/specs/code-execution-design.md`).

**Onboarding flow (v1):** the app asks for a Git HTTPS remote URL and a personal access token, then clones via `git_mobile.rs`. There is no "start a workspace from scratch on mobile" path in v1 — mobile always joins an existing, already-git-backed desktop workspace. Starting fresh from mobile alone is out of scope (below).

## Feature cuts (structural, not stylistic)

Two desktop features are hidden on iOS because the mechanism they depend on doesn't exist there, not because this spec chose to leave them out:

- **Run button on code blocks** (`code_run.rs`, `docs/specs/code-execution-design.md`). It works today by spawning a real, unsandboxed subprocess (`python`/`g++` on `PATH`). iOS's App Sandbox does not permit spawning arbitrary child processes, and there is no Python/C++ toolchain on the device regardless. A code block on iOS renders read-only: syntax-highlighted, any previously-pinned output still visible (pinned output is note content, per the existing "pin output" feature — it travels with the note like any other text), but no Run button, no output panel, no confirmation dialog. Nothing errors; the affordance simply isn't there.
- **"Open in IDE"** (`CodeBlockOpenInIde.ts` → `editor_launch.rs`). Same reasoning — there's no external editor installed to hand a path to. Hidden, not shown-and-failing.

Both are a `Platform.isMobile` (or equivalent Tauri mobile-detection) check at the toolbar level — the same per-block toolbar mechanism `CodeBlockToolbar.ts` already uses to show Run only for runnable languages (`docs/specs/code-execution-design.md`'s UI section) gets a second condition, not a new mechanism.

Everything else is in scope for parity: ink, PDF import, flashcards/spaced repetition, search, tags, diagrams, code-run *history and pinned-output viewing* (reading, not running).

## Engineering risk

Two unknowns are large enough to gate their surrounding work behind a spike rather than being assumed away by adding a build target:

- **The `git_mobile.rs` rewrite (above) is the bigger of the two.** It's not a spike so much as the largest single task in this port — reimplementing 12 operations against `gix` instead of shelling out. The risk isn't "does it compile," it's whether `gix`'s fetch/push/rebase support covers what `checked_rebase_onto_remote` and `checked_pull`'s fast-forward logic need closely enough to match desktop's behavior (and its existing conflict/diverged-state tests) without silent semantic drift. This should be built and tested operation-by-operation against the same fixtures `git.rs`'s own tests use, not written once and trusted.
- **PDF pipeline on iOS.** `pdfium-render` (`Cargo.toml`, feature `pdf-native`) binds to Google's pdfium, currently built for Windows. Getting an iOS-target (arm64 device + simulator) pdfium binary linked into the mobile build is real, unscoped work — either cross-compiling pdfium or sourcing a prebuilt iOS distribution.

  This one is called out as a **spike, gated before the rest of the PDF-import work is planned** — not assumed to "just work" by adding a target, and not a reason to cut PDF import from mobile scope preemptively. If the spike shows it's genuinely not feasible in reasonable time, PDF import becomes a documented v1 gap (note: reopens a "different product" question specifically for that one feature, to be decided then, not guessed at now).

## UI

The app shell (Tailwind v4 + shadcn/ui per CLAUDE.md) needs touch-sized targets and a mobile navigation reflow — sidebar becomes a drawer/sheet, the command palette and dialogs need touch-appropriate sizing, hover-only affordances (e.g. anything relying on `:hover` for discoverability) need a tap-visible equivalent. This is UI-layer work, scoped to the app shell only.

The TipTap editor surface and the ink Canvas (`src/ink/`, perfect-freehand) already consume pointer events generically (mouse, touch, and stylus all arrive as pointer events in the current implementation) — this layer is expected to port with comparatively little change, and is not a focus area of the implementation plan beyond verification.

## Testing

- Rust: `git_mobile.rs` gets its own unit test suite mirroring `git.rs`'s existing cases (repo-mode detection, unsafe-state detection, auto-commit, fast-forward pull, diverged/blocked push, rebase-onto-remote) against real local repos built with `gix`/temp directories in the test itself — not mocked network calls — so behavior is checked against the same scenarios desktop already covers, not just "does it compile." Other shared commands (notes, PDF parsing once the pdfium spike lands) are platform-agnostic and continue to run as-is.
- Frontend: existing Vitest suite is unaffected (it doesn't run on-device); the `Platform.isMobile` toolbar gating (Run/Open-in-IDE hidden) gets unit tests the same way `CodeBlockToolbar.ts`'s existing language-gating does.
- End-to-end: this repo's `e2e-verify` skill drives the compiled Windows app via WebdriverIO — it has no mobile equivalent today. Mobile verification for v1 is manual QA on-device (or simulator), not a new automated e2e harness; building one is out of scope here (YAGNI until mobile ships and regresses).

**DoD for this spec's scope:**
- A fresh iOS install can clone an existing Git-backed workspace (HTTPS URL + token) and show its notes.
- A note edited on mobile, once synced, shows the edit on desktop and vice versa; `git_mobile.rs`'s fast-forward-pull and diverged/blocked-state detection match `git.rs`'s behavior on the same test fixtures.
- A code block on iOS shows its content and any pinned output, with no Run button and no crash/error state.
- The pdfium spike has a clear yes/no answer recorded before PDF-import work is planned in detail.

## Out of scope (v1)

- **Android.** Later, separate pass — this spec's approach (Tauri mobile, git-only storage via `gix`) is expected to transfer, but isn't designed for it yet.
- **Issue #24 (web app).** Explicitly deferred to its own brainstorm; this spec makes no architectural commitment that constrains or presumes a web client.
- **Starting a brand-new workspace from mobile alone.** v1 always joins an existing desktop-created, Git-backed workspace.
- **The GitHub-repo picker** (`list_own_github_repos`, backed by the `gh` CLI). Mobile onboarding takes a pasted URL instead — see Onboarding above.
- **SSH key auth.** HTTPS + personal access token only for v1 — see Credentials above.
- **OS file-provider integration** (iCloud Drive / Files app / SAF-style folder access). Considered and rejected in favor of git-only — see Storage & sync above. Revisit only if a real workflow needs raw file access mobile-side.
- **Any new sync protocol, account system, or server.** Mobile rides the same Git remote the user already owns, per the existing "Cloud sync" cut in `docs/ROADMAP.md` §4.
- **MSVC / any change to desktop's code-execution feature.** Untouched by this spec; iOS just doesn't expose the Run affordance.
