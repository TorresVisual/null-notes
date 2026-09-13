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
- All sync after that runs through the same git-automation layer P5 already built for desktop (auto-commit debounce, pull/push, conflict/diverged-state surfacing) — reused as-is, not reimplemented. No new sync protocol, no server, no accounts.
- A note that exists only uncommitted-and-unpushed on desktop is invisible on mobile until it's pushed — identical to how two desktop machines behave today. This is not a new limitation mobile introduces; it's the existing model applied to a second device.
- `index.db` stays out of the workspace per the existing storage-boundary rule (rebuildable, not merged) — same SQLite index, same app-data-dir placement, now inside the iOS app container instead of the Windows app-data dir.

**Onboarding flow (v1):** the app asks for a Git remote URL and credentials (reusing whatever auth mechanism desktop's git-sync already uses — no new auth scheme designed here) and clones. There is no "start a workspace from scratch on mobile" path in v1 — mobile always joins an existing, already-git-backed desktop workspace. Starting fresh from mobile alone is out of scope (below).

## Feature cuts (structural, not stylistic)

Two desktop features are hidden on iOS because the mechanism they depend on doesn't exist there, not because this spec chose to leave them out:

- **Run button on code blocks** (`code_run.rs`, `docs/specs/code-execution-design.md`). It works today by spawning a real, unsandboxed subprocess (`python`/`g++` on `PATH`). iOS's App Sandbox does not permit spawning arbitrary child processes, and there is no Python/C++ toolchain on the device regardless. A code block on iOS renders read-only: syntax-highlighted, any previously-pinned output still visible (pinned output is note content, per the existing "pin output" feature — it travels with the note like any other text), but no Run button, no output panel, no confirmation dialog. Nothing errors; the affordance simply isn't there.
- **"Open in IDE"** (`CodeBlockOpenInIde.ts` → `editor_launch.rs`). Same reasoning — there's no external editor installed to hand a path to. Hidden, not shown-and-failing.

Both are a `Platform.isMobile` (or equivalent Tauri mobile-detection) check at the toolbar level — the same per-block toolbar mechanism `CodeBlockToolbar.ts` already uses to show Run only for runnable languages (`docs/specs/code-execution-design.md`'s UI section) gets a second condition, not a new mechanism.

Everything else is in scope for parity: ink, PDF import, flashcards/spaced repetition, search, tags, diagrams, code-run *history and pinned-output viewing* (reading, not running).

## Engineering risk: PDF pipeline on iOS

`pdfium-render` (`Cargo.toml`, feature `pdf-native`) binds to Google's pdfium, currently built for Windows. Getting an iOS-target (arm64 device + simulator) pdfium binary linked into the mobile build is real, unscoped work — either cross-compiling pdfium or sourcing a prebuilt iOS distribution — and is the single biggest unknown in this port.

This is called out as a **spike, gated before the rest of the PDF-import work is planned** — not assumed to "just work" by adding a target, and not a reason to cut PDF import from mobile scope preemptively. If the spike shows it's genuinely not feasible in reasonable time, PDF import becomes a documented v1 gap (note: reopens a "different product" question specifically for that one feature, to be decided then, not guessed at now).

## UI

The app shell (Tailwind v4 + shadcn/ui per CLAUDE.md) needs touch-sized targets and a mobile navigation reflow — sidebar becomes a drawer/sheet, the command palette and dialogs need touch-appropriate sizing, hover-only affordances (e.g. anything relying on `:hover` for discoverability) need a tap-visible equivalent. This is UI-layer work, scoped to the app shell only.

The TipTap editor surface and the ink Canvas (`src/ink/`, perfect-freehand) already consume pointer events generically (mouse, touch, and stylus all arrive as pointer events in the current implementation) — this layer is expected to port with comparatively little change, and is not a focus area of the implementation plan beyond verification.

## Testing

- Rust: existing unit tests for shared commands (git, notes, PDF parsing once the pdfium spike lands) are platform-agnostic and continue to run as-is; no mobile-specific Rust test surface is introduced by this spec beyond what the pdfium spike needs to prove it links and runs on-device.
- Frontend: existing Vitest suite is unaffected (it doesn't run on-device); the `Platform.isMobile` toolbar gating (Run/Open-in-IDE hidden) gets unit tests the same way `CodeBlockToolbar.ts`'s existing language-gating does.
- End-to-end: this repo's `e2e-verify` skill drives the compiled Windows app via WebdriverIO — it has no mobile equivalent today. Mobile verification for v1 is manual QA on-device (or simulator), not a new automated e2e harness; building one is out of scope here (YAGNI until mobile ships and regresses).

**DoD for this spec's scope:**
- A fresh iOS install can clone an existing Git-backed workspace and show its notes.
- A note edited on mobile, once synced, shows the edit on desktop and vice versa, using the existing git-automation conflict handling unchanged.
- A code block on iOS shows its content and any pinned output, with no Run button and no crash/error state.
- The pdfium spike has a clear yes/no answer recorded before PDF-import work is planned in detail.

## Out of scope (v1)

- **Android.** Later, separate pass — this spec's approach (Tauri mobile, git-only storage) is expected to transfer, but isn't designed for it yet.
- **Issue #24 (web app).** Explicitly deferred to its own brainstorm; this spec makes no architectural commitment that constrains or presumes a web client.
- **Starting a brand-new workspace from mobile alone.** v1 always joins an existing desktop-created, Git-backed workspace.
- **OS file-provider integration** (iCloud Drive / Files app / SAF-style folder access). Considered and rejected in favor of git-only — see Storage & sync above. Revisit only if a real workflow needs raw file access mobile-side.
- **Any new sync protocol, account system, or server.** Mobile rides the same Git remote the user already owns, per the existing "Cloud sync" cut in `docs/ROADMAP.md` §4.
- **MSVC / any change to desktop's code-execution feature.** Untouched by this spec; iOS just doesn't expose the Run affordance.
