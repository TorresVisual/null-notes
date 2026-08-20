# null-notes — Design Tokens

**Date:** 2026-08-20
**Scope:** P9.5-2. Extends "Terminal Precision" (shipped P2, `docs/specs/visual-design-system-design.md`) with the categories that spec didn't formalize: a named typography scale, a surface catalogue, and an interactive-state catalogue. Colors and spacing below are unchanged from P2 — restated here so this doc is a complete single reference, not a diff against another file.

All values are CSS custom properties in `src/index.css`'s `:root` block unless noted.

---

## Color

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#0d0f12` | Page / editor background |
| `--bg-raised` | `#111318` | Sidebar, tab bar, toolbars, modals, popovers |
| `--bg-sunken` | `#0a0b0d` | Nested rail elements, input backgrounds inside a raised panel |
| `--bg-hover` | `#161b22` | Hover fill |
| `--border` | `#1f242c` | Default dividers |
| `--border-strong` | `#2a2f38` | Emphasized borders (panels, inputs, cards) |
| `--text-primary` | `#e6edf3` | Primary reading text |
| `--text-secondary` | `#9da7b3` | De-emphasized text that's still read |
| `--text-tertiary` | `#565f6b` | Labels, metadata, disabled-adjacent text |
| `--text-disabled` | `#3a4048` | Placeholder / disabled text |
| `--accent` | `#7ee787` | Signal green — links, active states, primary affordance |
| `--accent-hover` | `#a3f0ac` | Accent hover |
| `--accent-bg` / `--accent-bg-hover` | `rgba(126,231,135,0.12/0.22)` | Accent-tinted fills (selection, active row) |
| `--accent-contrast` | `#0d0f12` | Text/icon color on a solid-accent fill |
| `--danger` | `#e05050` | Errors, destructive actions |

## Spacing

| Token | Value |
|---|---|
| `--space-xs` | `4px` |
| `--space-sm` | `8px` |
| `--space-md` | `12px` |
| `--space-lg` | `16px` |
| `--space-xl` | `24px` |
| `--space-2xl` | `32px` |

---

## Typography scale

Two families: `--font-sans` (`system-ui, -apple-system, sans-serif`) for anything read as prose, `--font-mono` (`'Cascadia Code', 'Fira Code', monospace`) for anything code- or terminal-adjacent. `--font-mono` replaces what was 12 separate copies of the same literal string across the stylesheet before this pass — one token, one place to change it.

Each scale entry is a `font` shorthand string, so a consumer writes one declaration (`font: var(--text-heading-1);`) instead of three:

| Token | Value | Applied to |
|---|---|---|
| `--text-display` | `600 20px/1.3 var(--font-mono)` | The one "brand moment" — `.workspace-picker-title` |
| `--text-heading-1` | `700 1.8em/1.3 var(--font-sans)` | `.note-editor h1` |
| `--text-heading-2` | `700 1.4em/1.3 var(--font-sans)` | `.note-editor h2` |
| `--text-heading-3` | `700 1.2em/1.3 var(--font-sans)` | `.note-editor h3` |
| `--text-body` | `400 15px/1.6 var(--font-sans)` | `body` (the app-wide default) |
| `--text-metadata` | `600 11px/1.4 var(--font-sans)` | Small uppercase labels — `.workspace-name` |
| `--text-code` | `400 13px/1.5 var(--font-mono)` | Representative value for UI-chrome monospace (popovers, editor status, kbd) |
| — math — | KaTeX, `1.15em` inline / `1.4em` block | Scales relative to context rather than a fixed token, since KaTeX sizes itself off the surrounding font-size |

**Known gap, deliberately not fixed here:** `--text-code`'s 13px is representative of most UI-chrome monospace text (`.block-math-editor-input`, `.math-snippet-trigger`, etc.), but individual sites still hardcode font-size (11px–14px, including `.raw-editor`'s deliberately-larger 14px for primary editing content) rather than consuming the token directly. Headings/body/display/metadata are wired to their tokens; unifying every remaining monospace font-size against `--text-code` is a judgment call about whether each difference is intentional hierarchy or drift, which belongs to P9.5-3's consistency audit, not this token-definition pass.

---

## Surface catalogue

| Surface | Background | Border | Elevation |
|---|---|---|---|
| Application background | `--bg-base` | — | — |
| Sidebar | `--bg-raised` | `--border` (right edge) | — |
| Editor | `--bg-base` | — | — |
| Hover | `--bg-hover` | — | — |
| Popover (math editor, slash menu, math-snippet menu) | `--bg-raised` | `--border-strong` | `--shadow-popover` |
| Modal (search, settings, graph view, task view, review session, formula sheet, import dialog) | `--bg-raised` | `--border-strong` | `--shadow-modal` |
| Command palette (search modal) | `--bg-raised` | `--border-strong` | `--shadow-modal` (shares the modal shell) |
| Context menu (folder right-click) | `--bg-raised` | `--border-strong` | `--shadow-context-menu` |

Three named elevation tokens replace what were three unnamed shadow literals repeated across 10 selectors:

```css
--shadow-popover: 0 12px 40px rgba(0, 0, 0, 0.5);
--shadow-modal: 0 24px 64px rgba(0, 0, 0, 0.6);
--shadow-context-menu: 0 12px 32px rgba(0, 0, 0, 0.5);
```

**Known gap, deliberately not fixed here:** `.block-handle-menu` uses a fourth, smaller shadow (`0 4px 16px rgba(0,0,0,0.4)`) not covered by any of the three tokens above. Whether that's an intentional "compact popover" tier or drift that should collapse into `--shadow-popover` is a call for P9.5-3, not this pass.

---

## Interactive-state catalogue

Eight states, each with a token or a documented convention:

| State | Convention |
|---|---|
| Default | Component's own base rule |
| Hover | `:hover`, typically `background: var(--bg-hover)` or `var(--border-strong)` |
| Active (pressed) | `:active` pseudo-class, typically `background: var(--bg-sunken)`. **Naming note:** several components already use a class named `.active` to mean "currently selected/open" (`.tree-row.active`, `.tab.active`, `.toolbar-button.active`) — that is a different, persistent state from the `:active` pseudo-class's momentary press feedback added by this pass. Don't confuse the two; the catalogue's "active" state is the pseudo-class. |
| Focused | `:focus-visible`, `box-shadow: var(--focus-ring)` where `--focus-ring: 0 0 0 2px var(--bg-base), 0 0 0 4px var(--accent)` |
| Disabled | `:disabled` (native) or `.is-disabled` (non-form elements), `opacity: var(--disabled-opacity)` (`0.4`) |
| Loading | `.is-loading`, `opacity: var(--loading-opacity)` (`0.6`) + `pointer-events: none`. No UI currently triggers this — everything in the app today is local/fast enough to not need a loading state — so this is a defined convention awaiting a real consumer, not yet exercised. |
| Error | `.is-error`, `border-color`/`color: var(--danger)` |
| Selected | `.is-selected` (generic) or an existing component-specific class (`.tree-row.selected`, `.search-result.selected`, `.slash-menu-item.selected`) |

### Spot-check (DoD): three arbitrary interactive elements, all eight states

**`.sidebar button`** (generic button):
```css
.sidebar button { /* default */ }
.sidebar button:hover { background: var(--border-strong); }
.sidebar button:active { background: var(--bg-sunken); }
.sidebar button:focus-visible { box-shadow: var(--focus-ring); }
.sidebar button:disabled { opacity: var(--disabled-opacity); }
.sidebar button.is-loading { opacity: var(--loading-opacity); }
.sidebar button.is-error { border-color: var(--danger); color: var(--danger); }
.sidebar button.is-selected { background: var(--accent-bg); color: var(--accent); }
```

**`.settings-row-control input`** (generic input):
```css
.settings-row-control input { /* default */ }
.settings-row-control input:hover { border-color: var(--text-tertiary); }
.settings-row-control input:active { border-color: var(--accent); }
.settings-row-control input:focus-visible { box-shadow: var(--focus-ring); }
.settings-row-control input:disabled { opacity: var(--disabled-opacity); }
.settings-row-control input.is-loading { opacity: var(--loading-opacity); }
.settings-row-control input.is-error { border-color: var(--danger); }
.settings-row-control input.is-selected { border-color: var(--accent); background: var(--accent-bg); }
```

**`.tree-row`** (tree row):
```css
.tree-row { /* default */ }
.tree-row:hover { background: var(--bg-hover); }
.tree-row:active { background: var(--bg-sunken); }
.tree-row:focus-visible { box-shadow: var(--focus-ring); }
.tree-row.is-disabled { opacity: var(--disabled-opacity); }
.tree-row.is-loading { opacity: var(--loading-opacity); }
.tree-row.is-error { color: var(--danger); }
.tree-row.selected { background: var(--bg-hover); } /* pre-existing */
```

**Known gap, deliberately not fixed here:** `.tree-row` is a plain `<li>` with an `onClick` handler (`TreeNode.tsx`) — it has no `tabIndex` and no keydown handler, so `:focus-visible` is defined in CSS but currently unreachable by keyboard. Making tree rows genuinely keyboard-operable is an interaction/accessibility fix, not a token-definition one; it's flagged here for P9.5-3/P9.5-4 rather than silently left looking more accessible than it is.
