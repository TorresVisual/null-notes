# Web app (issue #24)

## Problem

`docs/ROADMAP.md` cut the web app alongside mobile with the same one-line reasoning ("local-first/desktop-only was the assumption"). The maintainer reopened it 2026-09-09 (`TorresVisual/null-notes#24`) without re-scoping it. This is that scoping pass, done after Phase 16 (mobile) so the two don't collide — see `docs/specs/mobile-app-design.md`, which deliberately treated web as "a separate future brainstorm."

## Decision: what "web app" means

Full editor parity, same bar as mobile: create and edit notes, ink, flashcards, search, tags, diagrams, math — from a browser, joining an existing Git-backed workspace. Not a reader. There is no "start a workspace from scratch on web" path, same restriction mobile has — web always joins a workspace a desktop (or another) client already created.

**One exception to parity: PDF import is cut for v1.** Desktop's PDF pipeline reads a PDF's text layer via `pdfium-render`, a native library binding with no browser equivalent; the standard client-side alternative (`pdf.js`) would mean reimplementing the text-layer-to-Markdown/LaTeX reconstruction logic (`src-tauri/src/pdf/`) a second time against a different library's text-item API. That's real, separately-scoped work, not a corner this spec cuts casually — see Engineering risk. Existing PDF sidecars (`NoteName.pdf/`) already in a workspace are unaffected: they render and are editable on web exactly as on desktop, since they're just note content and assets by the time web opens them. Only importing a *new* PDF is unavailable in v1.

## Architecture: client-side only, no server for data

This project's stance on cloud sync (`docs/ROADMAP.md` §4) is explicit: "no accounts, no server, no sync protocol." The web app keeps that stance. It is a static site — same React/TipTap frontend as desktop and mobile (`src/`) — with every operation that currently goes through a Tauri command reimplemented against a browser-native equivalent. There is no backend that holds, proxies, or has visibility into note content.

The one exception is a CORS relay (below), which moves bytes without storing or reading them — closer to a dumb pipe than a server.

### Git: `isomorphic-git` + `lightning-fs`

Desktop's `git.rs` shells out to the `git` CLI; mobile's `git_mobile.rs` reimplements the same 12 operations against `gix` because iOS forbids subprocesses. A browser has the same restriction (no subprocess, no filesystem) for a different reason — there's no OS process model to shell out to at all.

Web gets a third implementation, `src/lib/gitWeb.ts` (frontend-only — there is no Rust backend on this platform, so this doesn't live in `src-tauri/`): **`isomorphic-git`**, the standard pure-JS git implementation, backed by **`lightning-fs`** (an IndexedDB-backed filesystem shim isomorphic-git is designed against). Same operation surface as `git.rs`/`git_mobile.rs` — repo-mode/unsafe-state detection, auto-commit, push, fetch/pull with fast-forward check, rebase-onto-remote, note-history, clone — so the rest of the frontend (`useWorkspaceStore`, the git-status UI) talks to a shape-compatible interface regardless of platform, the same way mobile kept the Tauri command names stable across `git.rs`/`git_mobile.rs`.

`index.db`'s workspace-vs-app-data split (CLAUDE.md, "The storage boundary") still applies conceptually even though there's no OS app-data dir on web: the SQLite index (below) is a separate IndexedDB database from the git-backed note files, not committed, rebuildable.

### CORS proxy (the one piece of shared infrastructure)

GitHub's and GitLab's git-over-HTTPS smart endpoints don't send CORS headers for arbitrary browser origins, so `isomorphic-git`'s `fetch()`-based clone/push/pull calls are blocked without a relay in front of them. This is a hard platform constraint, not a design choice — it's why every browser-based git tool (including isomorphic-git's own docs) ships with a proxy story.

A single, maintainer-owned **Cloudflare Worker** relays these requests: it forwards the git smart-HTTP protocol bytes to the real remote and forwards the response back, adding CORS headers. It does not terminate TLS to read content, does not log bodies, and holds no state between requests — the PAT in the `Authorization` header passes through it the same way it would pass through GitHub's own edge if the browser could reach it directly. This is the one server-shaped thing in the whole design, and its entire job is "add a CORS header," not "hold data."

### Credentials

Same mechanism as mobile — HTTPS + a personal access token, entered once during onboarding — but a browser has no Keychain equivalent. The token is stored in IndexedDB (not `localStorage`, which is synchronous and more casually leaked via any XSS in a way IndexedDB access at least requires an explicit async API for). This is a real, lower security bar than mobile's OS Keychain and desktop's OS-credential-helper inheritance, and this spec says so rather than implying parity that doesn't exist: a browser has no hardware-backed secret storage, full stop. This matches the "friction and visibility over containment" posture `docs/specs/code-execution-design.md` already applies elsewhere in this codebase — the mitigation is not pretending the token is as safe as on native, it's making sure a compromised page has to specifically go looking for it rather than reading an ambient global.

**Onboarding flow:** same as mobile — paste a Git HTTPS remote URL and a personal access token, clone via `gitWeb.ts` through the CORS proxy. No "pick from your GitHub repos" convenience (mobile's same `list_own_github_repos` gap — that's a `gh` CLI feature with no browser equivalent, and manual URL entry hasn't proven to be real friction on mobile either).

### Search index: `sql.js`

Desktop's `index.db` (SQLite, built by `src-tauri/src/db/`) drives search, tags, and backlinks via `reindex_note`. A client-only web app has no Rust process to run that in, but rewriting the index as a second, differently-shaped data structure would mean two index implementations with two sets of query bugs to keep in sync. Instead: **`sql.js`** (SQLite compiled to WASM) runs the *same* schema and the *same* queries `reindex_note` already uses, persisted to IndexedDB instead of a file on disk. `reindex_note`'s SQL (not its Rust glue) is the thing that ports; the debounce/trigger logic around it is reimplemented in TypeScript against the same "note writes don't block on DB work" principle CLAUDE.md's save-path section already states.

## Feature cuts (structural, not stylistic)

Same reasoning as mobile's App Sandbox cuts, for a browser's own equivalent restriction (no subprocess, ever, from a web page):

- **Run button on code blocks** (`code_run.rs`). No subprocess to spawn. Same treatment as mobile: read-only code block, pinned output (if any) still visible as note content, no Run affordance shown at all.
- **"Open in IDE"** (`editor_launch.rs`). No external editor to hand a path to from a browser tab. Hidden.
- **The P8 terminal** (`terminal.rs`). No PTY to spawn. Hidden.
- **PDF import** (above) — the one cut that isn't "no subprocess," it's "no pdfium binding," and is scoped as future work rather than assumed permanent.

Same UI mechanism as mobile: a platform check (`Platform.isWeb` alongside the existing `Platform.isMobile`) at the same per-block toolbar level `CodeBlockToolbar.ts` already branches on.

Everything else is in scope for parity: ink (Canvas + perfect-freehand already consume pointer events generically — expected to port with little change, same as mobile found), flashcards/spaced repetition, tags, diagrams (Mermaid, pure JS rendering already), math/STEM authoring (KaTeX, pure JS/CSS already) — none of these depend on a native binding or a subprocess, so none of them need a cut.

## Engineering risk

Three unknowns are large enough to gate their surrounding work behind a spike rather than assumed away by scaffolding a site:

- **`gitWeb.ts` against `isomorphic-git`.** The same category of risk as mobile's `git_mobile.rs` rewrite: does isomorphic-git's fetch/push/rebase support cover what `checked_rebase_onto_remote` and `checked_pull`'s fast-forward logic need, closely enough to match desktop's tested behavior (diverged/blocked states, conflict detection) without silent drift. Build and test operation-by-operation against the same fixtures `git.rs`'s tests use, mirroring how mobile validated `git_mobile.rs`.
- **The CORS proxy, end to end.** Prove a real clone/push/pull round-trip through a real Cloudflare Worker against a real GitHub remote, including large-file/pack transfer behavior — not just that CORS headers are present, but that the relay doesn't silently truncate or mishandle the git smart-HTTP protocol under real payloads.
- **`sql.js` bundle size and IndexedDB persistence.** `sql.js`'s WASM binary is not small, and IndexedDB-backed WASM SQLite has known gotchas around persistence timing (when does a write actually durably land vs. sit in an in-memory VFS layer). Needs a spike proving reindex-then-reload-then-query survives a real browser session before it's assumed as the answer.

PDF import (pdf.js rewrite) is explicitly **not** one of these three — it's cut from v1 entirely (Decision, above), not spiked-and-deferred.

## UI

Same reflow shape as mobile's Phase 16 work: sidebar becomes a drawer on narrow viewports, touch-sized targets, hover-only affordances get a tap/click-visible equivalent for touchscreen laptops and tablets in a browser. Unlike mobile, web also has to support a mouse-and-keyboard desktop-browser session at full width — so this is closer to "responsive," not "mobile-only re-layout." The app shell (Tailwind v4 + shadcn/ui per CLAUDE.md) already has the tokens and dialog chrome mobile's reflow reused; this reuses the same components again rather than building a third variant.

## Testing

- **`gitWeb.ts`:** a Vitest suite mirroring `git.rs`'s and `git_mobile.rs`'s existing cases (repo-mode detection, unsafe-state, auto-commit, fast-forward pull, diverged/blocked push, rebase-onto-remote), run against `lightning-fs`'s in-memory mode and a local git fixture server — not mocked network calls, same principle mobile's test suite already follows.
- **`sql.js` index:** unit tests against the same query cases `reindex_note`'s existing Rust tests cover, run against `sql.js`'s IndexedDB persistence, not just an in-memory instance, so the persistence-timing risk above is actually exercised.
- **Frontend:** existing Vitest suite is unaffected. `Platform.isWeb` toolbar gating gets unit tests the same way `Platform.isMobile`'s did.
- **End-to-end:** no existing e2e harness applies — `e2e-verify` drives the compiled Windows Tauri app, not a static site. A web e2e harness (Playwright against the deployed Cloudflare Pages site) is new work, scoped in the phase task list below rather than assumed to already exist.
