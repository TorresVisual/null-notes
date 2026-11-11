---
name: mobile-parity
description: Use when the user gives a screenshot (desktop or phone) of a null-notes screen and wants it to be a better, native-feeling experience on mobile — "make this work on mobile", "mobile parity", "how should this look on a phone", "this feels cramped on Android", "what would this be on iOS". Thinks through the phone experience for that screen (what to keep, move, cut, re-shape), grounds it in the real mobile shell and existing mobile specs, settles the look with phone mockups in the visual companion, and only then (if asked) implements. Use even if the user never says "skill" or names the screen — a screenshot plus any mobile intent is enough.
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

## 4. Settle the look in the visual companion — before any code

How it should look is decided by seeing it, not by reading a table. No implementation
starts until the user has looked at the phone mockups and approved one. Use the
superpowers visual companion (`superpowers:brainstorming` → its `visual-companion.md`:
`scripts/start-server.sh --project-dir <repo> --open`, push HTML fragments into
`screen_dir`, read `state_dir/events` for clicks). Ask the user before starting the server,
as that guide says.

Build the mockups so they are honest about the real app:

- **Phone-framed**, ~390×844, one frame per screen state (default, keyboard open, empty, long titles) — not a desktop mockup in a narrow box. Put the real tab bar / top bar in the frame so it's judged in context.
- **Real tokens and shapes**: use the colours, spacing and type from `docs/design-tokens.md` / `:root` in `src/index.css`, and mimic existing `.mobile-*` components (tab bar, sheet, FAB, topbar). A mockup in a foreign style gets approved and then can't be built.
- **Real content** from the user's screenshot (their actual note titles and labels), not lorem ipsum — long titles and dense rows are where phone layouts break.
- **2–3 genuinely different options** side by side (`.split` / `.cards`, each `data-choice`) when there is a real layout fork — e.g. bottom sheet vs full screen. One option only if the proposal has no real fork; don't invent alternatives.
- Label what changed relative to the desktop screenshot so the user sees the verdict table, not just pixels.

Then end the turn: give the URL (full, with `?key=`), one line on what's on screen, and wait.
On the next turn read `state_dir/events` plus the user's text, and iterate in a new
file (`…-v2.html`) until they approve. Terminal-only questions (scope, which elements to
cut) stay in the terminal — push a waiting screen when you leave the browser.

If the companion can't run (no browser, server won't start), fall back to a Playwright
screenshot of a static HTML mockup at 390×844 and show that — never skip the visual step.

## 5. Text that accompanies the mockups

Keep it short — the mockup carries the design. Lead with the verdict, then:

1. **Phone version in one sentence** — what this screen becomes.
2. **Element table** — each element from step 2 → verdict → one-line why.
3. **Layout** — the visual-companion mockup (step 4); no ASCII wireframe unless the companion can't run.
4. **Flow** — how you get in, how you get out (tab? sheet? back?), what the keyboard does.
5. **Implementation map** — files to touch, what branches on `isMobile()`, CSS to add under `.mobile-*`, which existing component to reuse. Flag anything that violates a CLAUDE.md rule (dialog CSS classes must exist in `index.css`; new `@tauri-apps/*` imports need a `src/web/` shim).
6. **Open questions** — only the ones that change the design (max 3). Pick a default and say so rather than stalling.

## 6. Implement only after the mockup is approved

Don't implement without an approved mockup *and* the user asking for it. Then: small
diffs, reuse `.mobile-*` classes and the dialog classes in `index.css`, add a Vitest case
for any new `isMobile()` branch (see `MobileShell.test.tsx` for the mocking pattern).

## 7. Verify the build against the approved mockup

Use `ui-preview`, forcing the mobile branch — its mock reports `windows`:

```js
await page.addInitScript({ path: '<repo>/.claude/skills/ui-preview/mock-tauri.js' })
await page.addInitScript(() => { window.__TAURI_OS_PLUGIN_INTERNALS__.platform = 'android' })
await page.setViewportSize({ width: 390, height: 844 })   // also try 360x740 and 412x915
```

Screenshot, **Read the PNG**, and compare it to the approved mockup, not just to "looks
fine". Spacing bugs here have repeatedly slipped past "the className exists" checks —
compare against a neighbouring reference element. Canned mock data means don't judge
information density. Screens needing real file I/O: `e2e-verify` or
`scripts/android-emulator.ps1`.

Notice something unrelated that's broken? Hand it to `capture-findings`, don't fix it inline.
