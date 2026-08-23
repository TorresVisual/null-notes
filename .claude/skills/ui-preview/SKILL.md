---
name: ui-preview
description: Use when doing visual/CSS/layout design work on null-notes (auditing hierarchy, spacing, wrapping, color, states) and you need to actually see a screen rendered, not just read the CSS. Lightweight — a real browser against the Vite dev server, no Tauri build. Not a substitute for e2e-verify: screens that need real workspace/note data won't populate.
---

# Previewing null-notes screens for visual/design work

## When to use this vs. e2e-verify

- **This skill** — fast iteration on chrome/layout/CSS: the workspace
  picker, sidebar shell, settings panel, shortcuts overlay, dialogs,
  empty states, anything reachable without live note data. No Rust
  rebuild, no WebdriverIO, screenshot in seconds.
- **`e2e-verify`** — anything that needs the real save path, file I/O,
  or actual note/workspace content on screen (editor content, sidebar
  file tree, tabs, search results). Drives the real compiled
  `null-notes.exe`.

Design work on this app tends to start here and only reach for
`e2e-verify` once a data-dependent screen needs checking.

## Why this works without Tauri

The frontend calls `@tauri-apps/api/core`'s `invoke()` directly
everywhere (`src/lib/tauri.ts`) with no mock/fallback layer. Outside a
real Tauri webview there's no `window.__TAURI_INTERNALS__`, so every
`invoke()` call rejects. Nothing in this app awaits that rejection
synchronously during render — state simply stays at its initial
loading/empty value — so the shell renders: sidebar buttons show
correctly (disabled when they require a workspace), the workspace
picker renders fully, panels/dialogs that don't fetch data open fine.
Screens whose entire content *is* fetched data (recent workspaces
list, note tree, search results) render empty instead of erroring.

## Launching

    npm run dev

Vite is pinned to port **1421** with `strictPort: true`
(`vite.config.ts`) — it will refuse to pick a different port.

**If you get `Error: Port 1421 is already in use`**, that's fine, not
a failure: it usually means a `tauri dev` session (or a previous
preview session) is already serving. Skip starting a new one and
navigate straight to it — the running server is what you want anyway.

## Viewing

Use the Playwright MCP tools:

1. `browser_navigate` to `http://localhost:1421`
2. `browser_resize` to a representative desktop window size (e.g.
   1400x900 — the app has no responsive breakpoints of its own, it's
   desktop-only)
3. `browser_click` / native `prompt()`/`confirm()` dialogs won't work
   here the way they do in the real app (no native dialog bridge) —
   for anything gated behind a native file/folder picker or
   `window.prompt`, you can't get past it this way. Settings, search
   modal shell, shortcuts overlay, template dialog, and the workspace
   picker itself are all reachable without one.
4. `browser_take_screenshot` — then **`Read` the saved PNG yourself**
   to actually look at it. Unlike `e2e-verify` (which tells the user
   to open the folder because it's a pass/fail verification step),
   design work needs you looking at the image to judge it, not just
   confirming it exists.

## Known gaps

- No workspace/note data — anything downstream of `invoke()` is
  empty, not populated. Don't judge information density or data-heavy
  layouts (note list, search results, tabs, editor content) from this;
  use `e2e-verify` for those.
- Console will show `invoke` rejection errors — expected noise, not a
  real bug, as long as the UI itself isn't blank/broken.
- Window chrome (title bar, native menu) isn't shown — this is
  webview content only.
