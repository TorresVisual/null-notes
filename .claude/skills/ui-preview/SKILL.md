---
name: ui-preview
description: Use when doing visual/CSS/layout design work on null-notes (auditing hierarchy, spacing, wrapping, color, states) and you need to actually see a screen rendered, not just read the CSS — including screens that need a workspace open (sidebar tree, tabs, editor chrome). Lightweight — a real browser against the Vite dev server, no Tauri build. Not a substitute for e2e-verify when real file I/O or the save path matters.
---

# Previewing null-notes screens for visual/design work

## Which mode

- **Bare** — navigate to the dev server, nothing injected. Enough for the
  workspace picker, settings, shortcuts overlay, template dialog, empty states.
- **Mocked** — inject `mock-tauri.js` (next to this file) before load. The app
  opens a fixture workspace: folder tree with a long-title note, a canvas,
  tags, an open tab with an editor containing a link, tag, tasks and a code
  block. Use it for anything that needs a workspace open.
- **`e2e-verify`** — the real save path, file I/O, search, anything whose
  correctness depends on the Rust backend. The mock returns canned data; it
  proves how a screen *looks*, never that it *works*.

## Why this works without Tauri

The frontend calls `invoke()` from `@tauri-apps/api/core` directly
(`src/lib/tauri.ts`), with no mock layer. Outside a webview there is no
`window.__TAURI_INTERNALS__`, so every `invoke()` rejects and screens whose
content is fetched data render empty. `mock-tauri.js` installs a fake
`__TAURI_INTERNALS__` (plus the event and OS plugin globals — without
`__TAURI_OS_PLUGIN_INTERNALS__` the layout throws in `isMobile()`) and answers
the startup commands.

## Launching

    npm run dev

Vite is pinned to port **1421** (`strictPort`). `Port 1421 is already in use`
is fine — a `tauri dev` or earlier preview session is serving; use it.

## Viewing

Playwright MCP, mocked mode — the init script must be registered *before*
navigation:

    browser_run_code_unsafe:
    async (page) => {
      await page.addInitScript({ path: '<repo>/.claude/skills/ui-preview/mock-tauri.js' })
      await page.setViewportSize({ width: 1400, height: 900 })
      await page.goto('http://localhost:1421')
      await page.waitForTimeout(1500)
    }

Bare mode: `browser_navigate` + `browser_resize` (the app is desktop-only, no
responsive breakpoints; use short heights like 1400x600 to test clipping).

Then `browser_take_screenshot` and **`Read` the PNG yourself** — design work
needs you to look at it, not just confirm it exists. Native `prompt()` /
`confirm()` and file pickers don't work here; settings, search modal shell,
shortcuts, template dialog and the picker don't need one.

### If the browser MCP says "Browser is already in use"

Its profile is held by another session (both Playwright MCP and chrome-devtools
MCP hit this). Don't fight it — run a standalone script with the Chromium
Playwright already downloaded (`~/AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe`):

    // in an empty temp dir:  npm i playwright-core
    const b = await chromium.launch({ executablePath: process.env.EXE })
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
    await p.addInitScript({ path: '<repo>/.claude/skills/ui-preview/mock-tauri.js' })
    await p.goto('http://localhost:1421'); await p.waitForTimeout(1500)
    await p.screenshot({ path: 'out.png' })

Use a Windows-form `EXE` path (`C:/Users/...`), not Git-Bash `/c/...`. Keep the
script outside the repo (no new dependency).

## Extending the mock

- Edit `NOTES` / `FOLDERS` / `CANVASES` / `CONTENT` at the top to preview other
  shapes: very long titles, deep trees, an empty workspace (`NOTES = []`).
- Commands without a handler reject and are recorded in `window.__mockMisses`.
  After driving a new screen, `page.evaluate(() => window.__mockMisses)` shows
  what it asked for; add a handler returning the shape in `src/types/index.ts`.
- A handler that is *missing* for a startup command can wedge the UI (e.g. an
  unhandled `watch_workspace` leaves the sidebar on "Opening…" forever) — if a
  screen looks stuck, check `__mockMisses` before suspecting CSS.
- `load_settings` is deliberately unhandled, so the app runs on defaults.

## Known gaps

- Canned data only: search results, backlinks, graph, tasks and flashcards are
  empty; saves are no-ops. Don't judge information density from this.
- Console shows `invoke` rejection noise for unhandled commands — expected.
- Window chrome beyond the in-app title bar (native menu) isn't shown.
