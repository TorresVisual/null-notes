# Security & bug audit — null-notes

**Date:** 2026-09-07 · **Commit:** b296b30 · **Scope:** `src/`, `src-tauri/src/`, `package.json`, `Cargo.lock`, CI workflows

**Tools run:** `tsc --noEmit` (clean), `npm audit` (65 advisories: 15 high / 50 moderate),
RustSec advisory-db matched against `src-tauri/Cargo.lock` (542 crates, 31 advisories),
plus manual review of every `#[tauri::command]`, every process-spawn site, and every
`dangerouslySetInnerHTML` / `innerHTML` sink.

`vitest` and `cargo clippy` could not be run from the audit environment (`node_modules`
holds Windows-native rollup binaries; no Rust toolchain on the device VM). CI already
runs both on every PR.

---

## Summary

| Sev | # | Theme |
|---|---|---|
| High | 5 | Untrusted note content reaches an unsanitised HTML sink in a webview with no CSP, and the IPC surface it can reach spawns arbitrary processes |
| Medium | 6 | Unbounded filesystem paths across note commands; three dependency advisories; one serializer injection |
| Low | 4 | No JS linter; dev-dependency advisories; unmaintained Rust crates; a write-capable workflow |

The high findings are not five separate problems — they are one chain. Each link is
individually defensible; together they turn *"open a note someone sent you"* into
*"run an arbitrary program."* The five entries below are the links, in the order an
attacker would traverse them.

**The threat model is the project's own.** `src-tauri/src/commands/editor_launch.rs`
already states it: a note is a hand-editable `.md` "that may have arrived by Git pull,
by Syncthing, or out of a converted PDF … the link target is attacker-influenced text."
That module then defends itself rigorously. The findings below are the places where the
same untrusted input reaches a sink that does not.

---

## HIGH

### H-1 · No Content Security Policy
**`src-tauri/tauri.conf.json:23`** — `"csp": null` · CWE-1021 / CWE-693

Tauri injects no CSP header at all when this is `null`. There is no `script-src`, no
`frame-src`, no `object-src`. Nothing constrains what an injected node may execute or
load, and the webview holds an authenticated `__TAURI__.invoke` handle to every command
in `lib.rs`'s `generate_handler!`.

**Risk:** on its own, a missing hardening layer. In combination with H-2/H-3, it is the
reason those become code execution rather than a rendering glitch.

**Fix:** set a real CSP — at minimum `default-src 'self'; script-src 'self'; object-src 'none'; frame-src 'none'`.
KaTeX and Tailwind will need `style-src 'self' 'unsafe-inline'`; note images load through
`read_note_asset` as base64, so `img-src 'self' data:` suffices. This is worth doing
even if H-2 and H-3 are fixed first.

### H-2 · Stored XSS — raw note HTML rendered verbatim, no sanitizer
**`src/editor/extensions/HTMLBlock.tsx:41`**, **`src/editor/extensions/HTMLInline.tsx:21`**,
enabled by **`src/editor/extensions/index.ts:178`** (`Markdown.configure({ html: true })`) · CWE-79

`HTMLBlock.parseHTML` captures `el.outerHTML` for every tag in `BLOCK_TAGS` and the node
view renders that string with `dangerouslySetInnerHTML`. `BLOCK_TAGS` includes the
script-bearing set explicitly (`HTMLBlock.tsx:17,19,21`):

```
'audio', 'video', 'picture', 'embed', 'object', 'iframe',
'svg', 'math',
'canvas', 'noscript', 'script', 'slot', 'template',
```

There is no sanitizer anywhere in the repo — no DOMPurify, no `sanitize-html`. The
round-trip is not accidental; `src/editor/extensions/htmlFeatures.test.ts:239-250`
asserts it as a feature ("preserves iframe blocks verbatim").

**Failure scenario:** a `.md` note containing
`<iframe srcdoc="&lt;script&gt;…&lt;/script&gt;"></iframe>` or
`<svg><animate onbegin="…"/></svg>` arrives via Git pull / Syncthing / a shared course
folder. Opening the note in null-notes executes the payload in the webview. `innerHTML`
does not run bare `<script>` tags, but `srcdoc`, `onbegin`, `onload` and `<object data="javascript:">`
all fire — and `iframe`, `svg` and `object` are all on the preserved list.

**Fix:** sanitize `html` before it reaches the sink. DOMPurify with a profile that drops
`on*` attributes, `javascript:`/`data:` URLs, and `iframe`/`object`/`embed`/`script`
would preserve the feature's actual intent (SVG figures, MathML, semantic sections)
while closing the sink. Sanitize on render, not on parse, so an unsanitised file on disk
is still rendered safely.

### H-3 · Stored XSS — Mermaid fallback interpolates note text unescaped
**`src/editor/extensions/MermaidBlock.tsx:24` and `:29`** · CWE-79

Mermaid's own output *is* safe — `securityLevel` defaults to `'strict'`, so the rendered
SVG passes through Mermaid's DOMPurify. Both fallback paths bypass that entirely:

```ts
.catch(() => setSvg(`<pre class="mermaid-error">${code}</pre>`))   // line 24
<div dangerouslySetInnerHTML={{ __html: svg || `<pre>${code}</pre>` }} />   // line 29
```

`code` is raw note content interpolated into an HTML string with no escaping, then fed
to `dangerouslySetInnerHTML`.

**Failure scenario:** a fenced ```` ```mermaid ```` block whose body is
`<img src=x onerror=…>`. It is not valid Mermaid, so `render()` rejects, the `.catch`
fires, and the payload is injected. Line 29 injects it even earlier — on the first paint,
before `render()` has resolved, for *every* mermaid block regardless of validity.

**Fix:** escape `code` (`src/lib/htmlAttr.ts` already exports `encodeAttr`), or better,
render the fallback as a React `<pre>{code}</pre>` and drop `dangerouslySetInnerHTML`
from this component — the sink is only needed for Mermaid's own sanitised SVG.

### H-4 · Exec-capable commands take the program name from frontend arguments
**`src-tauri/src/commands/terminal.rs:57`**, **`code_run.rs:176`**, **`editor_launch.rs:117`** · CWE-94 / CWE-862

Three commands spawn a process whose *executable* is chosen by a string the frontend
passes in:

| Command | Frontend-controlled argument | Becomes |
|---|---|---|
| `terminal_open` | `shell` | `parse_shell` (terminal.rs:16) splits it into program + args, then `CommandBuilder::new(program)` |
| `run_code` | `python_command`, `cpp_compiler_command` | `python_argv` / `cpp_compile_argv` → `Command::new(program)` |
| `open_in_editor` | `template` | `build_command` (editor_launch.rs:88) → first token is the program |

None of the three validates the program against an allowlist, and `terminal_write`
additionally feeds arbitrary bytes to a live shell.

The only gate is **`src/store/codeRunConfirm.ts`** — a native confirm dialog backed by an
in-memory `Set<string>` in the renderer. Its own docstring says so: *"This is the
feature's whole security model: friction and visibility, not a sandbox."* That is a
reasonable posture against *the user pasting sketchy code*. It is no defense at all
against injected JS, which calls `invoke('terminal_open', { shell: '…' })` directly and
never touches the store.

**Failure scenario:** the H-2 or H-3 payload runs one line —
`__TAURI__.core.invoke('terminal_open', {workspace:'C:\\', shell:'powershell -c <payload>'})` —
and gets arbitrary code execution as the user. `run_code` and `open_in_editor` are
equivalent primitives.

**Fix (defense in depth, in priority order):**
1. Move the trust decision into Rust. Read `terminal_shell` / `python_command` /
   `cpp_compiler_command` / `editor_command` from `settings.json` **in the command
   itself** rather than accepting them as parameters. The frontend then cannot choose
   the program at all, and the settings file becomes the single place the value is set.
2. Keep the confirm dialog, but back it with backend state (a `tauri::State` flag set by
   a dedicated command) so the gate is not a renderer-side `Set`.

Note the contrast worth preserving: `editor_launch.rs` defends its *`target`* argument
impeccably (`resolve_in_workspace`, tokenize-before-substitute, tests for spaces and
metacharacters). It is the *`template`* argument — the one nobody thought of as
attacker-reachable — that is open.

### H-5 · Arbitrary settings persistence makes H-4 survive a restart
**`src-tauri/src/commands/settings.rs:48`** · CWE-94

`save_settings` accepts a whole `AppSettings` from the frontend and writes it to
`settings.json` with no validation. Four of its fields are the program names H-4 spawns.

**Failure scenario:** the injected payload writes `terminal_shell` (or `python_command`)
once. From then on the malicious program is what the app spawns when the user opens the
terminal pane or clicks Run — no XSS needed on subsequent launches, and the payload
outlives the note being deleted.

**Fix:** validate the exec-related fields on save (reject anything not resolvable on
`PATH`, or allowlist known programs), and/or make the terminal/run settings editable only
through the settings UI writing a separate, validated command.

---

## MEDIUM

### M-1 · Note commands accept unbounded absolute paths
**`src-tauri/src/commands/notes.rs:649, 716, 1110, 1449`**, **`printing.rs:208`** · CWE-22

| Command | Line | Primitive |
|---|---|---|
| `open_note(path)` | notes.rs:649 | `read_to_string` on any path — arbitrary file read |
| `save_note(path, content)` | notes.rs:716 | `write_atomic` to any path — arbitrary file write |
| `delete_note(path)` | notes.rs:1110 | `remove_file` **plus** `remove_dir_all` on four derived sidecar dirs |
| `read_template(path)` | notes.rs:1449 | arbitrary file read |
| `export_pdf(path)` | printing.rs:208 | arbitrary file write |

No workspace containment, no `Component::Normal` check, no canonicalize-and-compare —
whatever string arrives is used. `delete_note_at` is the sharpest of these: it deletes
the named file and then recursively removes `<stem>.ink`, `<stem>.pdf`, `<stem>.diagrams`
and `<stem>.assets` beside it.

This is the same class the codebase already knows how to solve — `assets.rs`'s
`resolve_relative` and `editor_launch.rs`'s `resolve_in_workspace` both enforce
containment correctly, with tests. The invariant simply was not applied to the note
commands.

**Risk:** only reachable from the renderer, so it is a privilege-escalation *step* rather
than a standalone hole — but it is exactly what makes H-2 worth more than a defacement.

**Fix:** a shared `resolve_in_workspace(workspace, path)` helper applied to every note
command, with `workspace` already threaded through most of these signatures.

### M-2 · `@tiptap/*` pinned below the fix for GHSA-cp6q-959q-f8rh
**`package.json`** (exact pins + `overrides`) · installed `@tiptap/core` **3.27.4**

Advisory: *"mergeAttributes() turns an own `__proto__` key into inherited executable DOM
attributes"* (CWE-79 + CWE-1321), affecting `>=2.0.0-alpha.0 <3.30.4`. 3.27.4 is in range.
Roughly 30 `@tiptap/*` packages in the tree are flagged.

The pins are deliberate — the comment in `package.json` explains that a second nested
`@tiptap/core` breaks typecheck — but the consequence is that `npm audit fix` cannot move
this. Both the exact versions **and** the `overrides` block need bumping to `3.30.4+`
together.

Relevant here because `HTMLBlock`/`DivBlock`/`SpanStyle` all pass note-derived attribute
objects through `mergeAttributes`.

### M-3 · `sqlx` 0.7.4 — RUSTSEC-2024-0363
**`src-tauri/Cargo.toml`** declares `sqlx = { version = "0.7", … }`

Binary-protocol misinterpretation caused by truncating/overflowing casts; patched in
`>= 0.8.1`. Exploitability here is limited (local SQLite, no untrusted protocol peer), but
it is a direct dependency one minor version behind a security fix.

### M-4 · `rustls-webpki` 0.101.7 — three advisories
Reached transitively via `sqlx`'s `runtime-tokio-rustls` feature:

- RUSTSEC-2026-0098 — name constraints for URI names incorrectly accepted
- RUSTSEC-2026-0099 — name constraints accepted for wildcard-asserting certificates
- RUSTSEC-2026-0104 — reachable panic in CRL parsing

Fixed by the M-3 bump (sqlx 0.8 pulls a current rustls stack).

### M-5 · DivBlock serializer builds attributes by unescaped concatenation
**`src/editor/extensions/DivBlock.ts:10-17`** · CWE-116

```ts
if (attrs.align) parts.push(` align="${attrs.align}"`)
if (attrs.className) parts.push(` class="${attrs.className}"`)
if (attrs.style) parts.push(` style="${attrs.style}"`)
```

`align`, `class` and `style` are read straight off the source note's DOM
(`DivBlock.ts:48-52`) and written back into the saved Markdown with no quote escaping.
An attribute value containing `"` closes the attribute early and injects arbitrary
markup into the user's `.md` file.

**Failure scenario:** a note containing `<div style='x" onmouseover="…'>` round-trips to
`<div style="x" onmouseover="…">` on disk. The re-parse only reads `align`/`style`/`class`,
so the injected handler does not fire in the editor — but the file is now corrupted with
attacker-chosen markup that *will* fire anywhere else the `.md` is rendered as HTML
(export, a static-site build, GitHub's own renderer).

**Fix:** use the existing `encodeAttr` from `src/lib/htmlAttr.ts` for all three values.
`SpanStyle`'s `buildStyle` is not affected (it emits a composed style string, no quotes),
but is worth checking for the same shape if it grows.

### M-6 · `git show` builds its revision argument by interpolation
**`src-tauri/src/commands/git.rs:541`** · CWE-88

```rust
.arg(format!("{sha}:{relative_git}"))
```

`sha` arrives from the frontend (`read_note_at_commit`) with no validation. Every other
`git` invocation in this file is exemplary — one `.arg()` per token, `--` before every
pathspec. This is the one place a caller-supplied string is concatenated into an argument.

Practical exploitability is low: git parses `-…:path` as an unknown option and errors out
rather than doing anything useful. Worth fixing for consistency with the rest of the
module.

**Fix:** validate `sha` against `^[0-9a-fA-F]{7,40}$` before use.

---

## LOW

### L-1 · No JavaScript/TypeScript linter configured
No `eslint`/`biome`/`oxlint` config file and none in `devDependencies`. CI
(`.github/workflows/ci.yml`) runs `npm run build`, `typecheck`, `test`, `cargo fmt`,
`cargo clippy -D warnings`, `cargo test` — thorough on the Rust side, nothing on the JS
side beyond type checking.

`tsc` cannot see H-2 or H-3; `eslint` with `react/no-danger` and
`eslint-plugin-no-unsanitized` would have flagged all six `dangerouslySetInnerHTML`
sites and the `innerHTML` assignments. Worth adding to CI alongside clippy.

### L-2 · 15 high-severity npm advisories, all in the e2e dev tree
All fifteen sit under `@wdio/*` → `@puppeteer/browsers`: `extract-zip` symlink path
traversal (CVSS 8.1), `serialize-javascript` RCE (8.1), `lodash-es` `_.template` code
injection (8.1), `nanoid` integer overflow (7.4). Dev-only, never shipped — but they run
in CI and on dev machines. `@wdio/tauri-service` currently pins the tree; the audit's
suggested fix is a semver-major downgrade, so this needs a look rather than an
`npm audit fix --force`.

### L-3 · Rust advisories beyond M-3/M-4
Patch available: `anyhow` 1.0.102 (RUSTSEC-2026-0190, unsoundness in `Error::downcast_mut`
→ ≥1.0.103), `event-listener` 5.4.1 (RUSTSEC-2026-0221 → ≥5.4.2), `crossbeam-epoch`
0.9.18 (RUSTSEC-2026-0204 → ≥0.9.20), `quick-xml` 0.39.4 (RUSTSEC-2026-0194/0195, two
DoS → ≥0.41.0). Most are transitive through `tauri`; a `cargo update` moves several.

No patch — unmaintained, informational only: the gtk-rs 0.18 GTK3 bindings (Linux
builds), `ring`, `paste`, `proc-macro-error`, `dirs`, and the `unic-*` family.

**Suggestion:** add `cargo audit` (or `cargo deny`) to `.github/workflows/ci.yml`
alongside the existing clippy step — it is the one class of finding here that CI could
have caught unaided.

### L-4 · `format.yml` holds `contents: write` and pushes to the branch
`.github/workflows/format.yml` runs `cargo fmt` and pushes a commit. It is
`workflow_dispatch`-only, which bounds it well. Noting it only because it is the one
workflow with write permission; no change needed unless it ever gains a `pull_request`
trigger.

---

## What is already right

Worth recording, because several of these are the reason the findings above are as
contained as they are:

- **`editor_launch.rs`** — no shell ever, tokenize-before-substitute, `Component::Normal`
  path containment, and tests that specifically prove a path with spaces stays one
  argument and shell metacharacters cannot split a command.
- **`git.rs`** — argv-style throughout, `--` before every pathspec, push policy enforced
  structurally in Rust rather than only in the UI (`checked_push`).
- **`assets.rs`** — `resolve_relative` refuses escaping paths as written rather than
  normalising them, with tests covering the "escape to a target that really exists" case.
- **`printPreviewCss.ts`** — escapes the note title before it enters a CSS `content:` string.
- **KaTeX** — `renderToString` used with default `trust: false`, so `\href{javascript:…}`
  and `\htmlData` are already blocked.
- **`tsc --noEmit`** passes clean across the whole frontend.

---

## Suggested order of work

1. **H-3** — smallest diff of the three XSS fixes, closes a definite injection today.
2. **H-2** — add DOMPurify at the two `dangerouslySetInnerHTML` sites.
3. **H-4 / H-5** — move the four exec-command settings out of the IPC parameter list and
   read them in Rust; this is the fix that holds even if a future XSS slips through.
4. **H-1** — set a CSP; verify KaTeX/Tailwind/base64 images still render.
5. **M-1** — one shared workspace-containment helper across the note commands.
6. **M-2 / M-3** — dependency bumps (tiptap pins *and* overrides together; sqlx 0.7 → 0.8).
7. **M-5, M-6, L-1, L-3** — escaping, sha validation, eslint + cargo-audit in CI.
