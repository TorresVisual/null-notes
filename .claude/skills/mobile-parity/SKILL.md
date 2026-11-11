---
name: mobile-parity
description: Use when the user gives a screenshot (desktop or phone) of a null-notes screen and wants it to be a better, native-feeling experience on mobile — "make this work on mobile", "mobile parity", "how should this look on a phone", "this feels cramped on Android", "what would this be on iOS". Thinks through the phone experience for that screen (what to keep, move, cut, re-shape), grounds it in the real mobile shell and existing mobile specs, then produces a concrete proposal and, if asked, the implementation. Use even if the user never says "skill" or names the screen — a screenshot plus any mobile intent is enough.
---

# Mobile parity from a screenshot

The screenshot shows a screen. The job is to decide what that screen should *be* on a
phone — not to shrink it. A phone has one thumb, ~400px, a keyboard that eats half the
screen, no hover, no right-click, no hotkeys, and a back button. Parity means the
**job** the screen does survives, not that every control does.

## 1. Ground yourself before opining

Read only what applies; each of these already encodes decisions you must not contradict.

- `docs/specs/mobile-app-design.md` — what mobile is and which features are structurally cut (no process spawn: Run button, git CLI, editor launch).
- `docs/specs/mobile-jot-and-review-design.md` — the shipped direction: capture fast, review first, read-mode by default with an explicit edit mode.
- `docs/plans/mobile-app-shell-reflow.md`, `docs/plans/mobile-feature-cuts.md` — shell structure and the cut list.
- The shell itself: `src/components/MobileShell.tsx`, `MobileTabBar.tsx`, `MobileNotes.tsx`, `MoreSheet.tsx`, and the `.mobile-*` block in `src/index.css` (~L417–650). Tabs are Home / Notes / Search / More; secondary actions live in the More sheet.
- `isMobile()` in `src/lib/platform.ts` is the branch point. Find the screen's component (grep a visible string from the screenshot) and check how it already branches.

Use `graphify query` first (this repo has a graph) to locate the component and its existing mobile branches.

## 2. Read the screenshot as jobs, not pixels

List, in a few lines:

1. **The job** — what the user came to this screen to do, in one sentence.
2. **Every control/region visible**, each tagged: *primary job* / *secondary* / *desktop-only* (hover, hotkey, power-user, multi-pane) / *chrome*.
3. **What it assumes** — width, a mouse, a second pane, a keyboard shortcut, hover reveal.

If the screenshot is already a phone shot, do the same and add: what is cramped, what is under the thumb zone, what is a sub-44px target.

## 3. Decide per element — one verdict each

| Verdict | Use when |
|---|---|
| **Keep** | Primary job; reflows fine in one column |
| **Reshape** | Right job, wrong form: side panel → full screen/bottom sheet; hover menu → long-press or visible overflow; split pane → stacked screen with back; table → list rows/cards |
| **Promote** | Thumb-critical action → bottom edge / FAB / keyboard-riding toolbar |
| **Demote** | Rare action → More sheet or a row's overflow |
| **Cut** | Desktop-only, or structurally impossible (process spawn, native folder pick). Say it is cut on purpose |
| **Add** | Mobile-only need the desktop version doesn't have: swipe, pull-to-refresh, share target, safe-area handling, back-button behaviour |

Rules of thumb that matter here:

- **Reading is the default, editing is deliberate** — this app's shipped model. New screens should open read-first where content is involved.
- **Back is always one step up the stack.** Anything that opens over something needs an explicit close and must be wired into `useBackButton` / `src/lib/backNavigation.ts`, or Android back exits the app.
- **Targets ≥ 44px, spacing ≥ 8px between them.** `@media (hover: none)` already bumps sheet actions to 48px; follow that pattern, don't invent a new one.
- **Nothing important reveals on hover.** Make it visible or move it behind a tap.
- **Keyboard is a layout event.** Anything with an input must stay visible when it opens (`useKeepCaretVisible`, the keyboard-riding edit toolbar).
- **Safe areas**: use `--safe-*` vars, not hardcoded padding.
- **Fewer modes, not more.** Prefer one clear action over a toolbar of eight.
- Don't add a screen the tab bar can't reach.

## 4. See it before judging it (when feasible)

Use the `ui-preview` skill, but force the mobile branch — its mock reports `windows`:

```js
await page.addInitScript({ path: '<repo>/.claude/skills/ui-preview/mock-tauri.js' })
await page.addInitScript(() => { window.__TAURI_OS_PLUGIN_INTERNALS__.platform = 'android' })
await page.setViewportSize({ width: 412, height: 915 })   // also try 360x740 and 390x844
```

Screenshot, then **Read the PNG** — also compare against the user's screenshot. Check the
real shell, not a squeezed desktop. Canned mock data means don't judge information density.
Skip this step if the user only wants a design opinion, or the screen needs real file I/O
(use `e2e-verify` / the emulator script `scripts/android-emulator.ps1` for that).

## 5. Output

Lead with the verdict, then the proposal. Keep it scannable:

1. **Phone version in one sentence** — what this screen becomes.
2. **Element table** — each element from step 2 → verdict → one-line why.
3. **Layout sketch** — a small ASCII wireframe of the phone screen (top bar / content / bottom).
4. **Flow** — how you get in, how you get out (tab? sheet? back?), what the keyboard does.
5. **Implementation map** — files to touch, what branches on `isMobile()`, CSS to add under `.mobile-*`, which existing component to reuse. Flag anything that violates a CLAUDE.md rule (dialog CSS classes must exist in `index.css`; new `@tauri-apps/*` imports need a `src/web/` shim).
6. **Open questions** — only the ones that change the design (max 3). Pick a default and say so rather than stalling.

Don't implement unless asked. If asked: small diffs, reuse `.mobile-*` classes and the
dialog classes in `index.css`, add a Vitest case for any new `isMobile()` branch (see
`MobileShell.test.tsx` for the mocking pattern), then verify visually per step 4.
Spacing bugs here have repeatedly slipped past "the className exists" checks — compare a
screenshot against a neighbouring reference element.

Notice something unrelated that's broken? Hand it to `capture-findings`, don't fix it inline.
