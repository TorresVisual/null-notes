---
name: Null Notes
description: Terminal Precision — a near-black, single-accent Markdown notebook for CS coursework.
colors:
  signal-green: "#7ee787"
  signal-green-hover: "#a3f0ac"
  signal-green-ink: "#0d0f12"
  ground: "#1f1f1f"
  raised: "#181818"
  sunken: "#121212"
  hover-fill: "#2a2a2a"
  hairline: "#2c2c2c"
  hairline-strong: "#3a3a3a"
  text-primary: "#e6edf3"
  text-secondary: "#9da7b3"
  text-tertiary: "#808a96"
  text-disabled: "#6a737e"
  danger: "#e05050"
  warning: "#d29922"
  cat-blue: "#58a6ff"
  cat-purple: "#bc8cff"
  cat-teal: "#39c5cf"
  cat-orange: "#f0883e"
  cat-pink: "#f778ba"
typography:
  display:
    fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  headline:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "1.8em"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "1.2em"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
  code:
    fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  panel: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-sidebar:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
  button-sidebar-hover:
    backgroundColor: "{colors.hover-fill}"
  button-sidebar-selected:
    backgroundColor: "rgba(126, 231, 135, 0.12)"
    textColor: "{colors.signal-green}"
  tab:
    textColor: "{colors.text-tertiary}"
    padding: "6px 12px"
  tab-active:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text-primary}"
  input:
    backgroundColor: "{colors.hover-fill}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "5px 8px"
  panel:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.panel}"
    padding: "{spacing.lg}"
  code-block:
    backgroundColor: "{colors.hover-fill}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
---

# Design System: Null Notes

## Overview

**Creative North Star: "Terminal Precision"**

CS coursework is exact, so the interface is not softer than the material it holds. Chrome is a near-black ground with one signal-green accent in place of a palette; anything symbolic (code, math, tags, kbd) is monospace; corners are small. The terminal supplies the *precision* register. The notebook supplies the *subject*: headings and body are sans-serif at real reading sizes, because monospace headings hurt scannability at the volume a course produces. Precision language stops where it would compromise reading, and that boundary is the design.

The app is a desktop tool used for hours: dense, quiet, always dark, single theme. Brand shows up in precise details (the 4px accent underline on the active tab, the focus ring, the green selection tint), never in decoration. The only light theme is the print/PDF-export surface, which swaps the whole token set to white-on-black-ink so a printed page does not spend toner on a dark ground.

**Key Characteristics:**
- Near-black ground, tonal layering instead of shadows for in-page chrome
- One accent (signal green) plus semantic danger/warning; categorical hues only for the agent canvas
- Monospace for code/math/chrome-symbols, sans for prose and headings
- Small radii (3–8px), hairline borders, no pills in chrome
- Two motion durations, two curves, no overshoot

## Colors

A cold neutral ground in three stepped depths, one phosphor green, and text in four tiers. Everything else is semantic.

### Primary
- **Signal Green** (`#7ee787`): links, active/selected state, focus ring, primary affordance, the pencil-ring of the app icon. Hover is **Signal Green Lifted** (`#a3f0ac`). Fills use the tint `rgba(126,231,135,0.12)` (rest) / `0.22` (hover). Text or icons on a solid green fill use **Signal Ink** (`#0d0f12`).

### Neutral
- **Ground** (`#1f1f1f`): page and editor background.
- **Raised** (`#181818`): sidebar, tab bar, toolbars, modals, popovers. *Darker* than ground: raised surfaces recede into the frame rather than float toward the reader.
- **Sunken** (`#121212`): nested rails, pressed state, inputs inside a raised panel.
- **Hover Fill** (`#2a2a2a`): hover background, inline code and code-block background, form-control fill.
- **Hairline** (`#2c2c2c`) / **Hairline Strong** (`#3a3a3a`): default dividers / panel, input and card borders.
- **Text Primary** (`#e6edf3`), **Secondary** (`#9da7b3`, still read), **Tertiary** (`#808a96`, labels and metadata; 4.7:1 on ground), **Disabled** (`#6a737e`, 3.4:1; never for anything that must be read).

### Semantic
- **Danger** (`#e05050`): errors, destructive actions. **Warning** (`#d29922`): stale code links, suspended cards, skipped or failed commits. Success aliases Signal Green; there is no second green.

### Categorical (agent canvas only)
- Blue `#58a6ff`, purple `#bc8cff`, teal `#39c5cf`, orange `#f0883e`, pink `#f778ba`, assigned per pass number by the app and never read from the file. Callout variants and JSON Canvas presets draw from the same set.

### Named Rules
**The One Voice Rule.** Green is the only brand color. A new feature that wants a second hue uses a semantic token or, if it needs eight distinguishable colours, the categorical set, and nowhere else.

**The Tint-Not-Fill Rule.** Selection and active rows are `accent-bg` plus green text, not a solid green block. Solid green is reserved for the one primary action in a surface.

**The Token Bridge Rule.** Never hardcode a colour. shadcn components read `--primary`, `--card`, `--muted` etc., which point at the tokens above. Brand green rides `--primary`; shadcn's own `--accent` (a hover highlight) is routed to `--menu-highlight-*` so the two meanings never collide.

## Typography

**Prose Font:** system-ui (with -apple-system, sans-serif) · **Mono Font:** Cascadia Code (with Fira Code, Consolas, monospace)

**Character:** The operating system's own sans for everything read; a programmer's monospace for everything executed or symbolic. No webfonts: it loads instantly offline and matches the OS it sits in.

### Hierarchy
- **Display** (600, 20px, 1.3, mono): the one brand moment, the workspace-picker title. Used once.
- **Headline** (700, 1.8em / 1.4em / 1.2em / 1.05em for h1–h4, 1.3–1.4): editor headings. Sans, bold, never mono.
- **H5 / H6** (600, 1em / 0.9em, `text-secondary`): present because Tailwind's preflight flattens headings to body size.
- **Body** (400, 15px, 1.6): the whole app default and the note text.
- **Label** (600, 11px, 1.4, uppercase): section captions such as the workspace name.
- **Code** (400, 13px, 1.5, mono): UI-chrome monospace. Code blocks follow the user's `--code-font-size` setting; inline code is 0.9em. Math is KaTeX at 1.15em inline / 1.4em block, sized off its surroundings.

### Named Rules
**The Reading Boundary Rule.** Mono is for symbols, never for sentences or headings. If it would be read as prose, it is sans.

**The Token Shorthand Rule.** Each scale entry is a `font` shorthand (`font: var(--text-heading-1)`). Use it instead of three declarations. Hand-set monospace sizes (11–14px) are known drift.

## Layout

A desktop shell: a left sidebar (workspace tree, bookmarks), a tab bar over one or more editor groups, and a single editor column on the `ground` background. Fixed desktop window class; there are no responsive breakpoints and no touch layout (the `--safe-*` insets exist for the iOS build only).

Spacing is a six-step scale (4 / 8 / 12 / 16 / 24 / 32px). Chrome rows are dense: 6–7px vertical padding on 13px text. Settings is a real window scaled down: a 210px section nav on the left, one section's cards on the right, fixed height (`min(620px, 100vh − 60px)`) so switching sections never resizes it. Dialogs are 440px wide unless they need more.

## Elevation & Depth

Tonal layering first, shadow only for things that float above the page. In-page chrome is flat: depth is *raised* (darker than ground) and *sunken* (darker still), separated by 1px hairlines. Shadows are heavy and black because the ground is already dark; they exist to detach, not to decorate.

### Shadow Vocabulary
- **Popover** (`0 12px 40px rgba(0,0,0,0.5)`): math editor, slash menu, snippet menu.
- **Modal** (`0 24px 64px rgba(0,0,0,0.6)`): search/command palette, settings, graph, tasks, review, import.
- **Context Menu** (`0 12px 32px rgba(0,0,0,0.5)`): folder right-click.
- **Compact** (`0 4px 16px rgba(0,0,0,0.4)`): block-handle menu, the small-popover tier.

### Named Rules
**The Flat-Until-Floating Rule.** A surface gets a shadow only if it overlays other content and is dismissed by clicking away. Panels that sit in the layout use a border.

**The Pick-A-Tier Rule.** A new floating surface picks one of the four shadow tokens. It does not invent a fifth.

## Shapes

Small, geometric, consistent. The stylesheet's dominant radii are 4px (inputs, small controls), 6px (buttons, code blocks, callout right edge), and 8px; 3px for inline code; 10px for dialog panels (`--radius: 0.625rem` for shadcn). Circles (`50%`) for avatars, dots and radio marks. Pills (`999px`) are used once. Borders are always 1px hairlines; the only thick stroke is a 4px left rule on callouts, blockquotes and collapsible sections, because those are *content semantics* defined by the Markdown model, not decoration.

The brand brief says "sharp over soft"; in practice that means *small* radii, never zero and never bubbly. Do not round more than 10px in chrome.

### Named Rules
**The Content-Stripe Rule.** A side stripe is allowed on note content (callouts, blockquotes, details) and nowhere in app chrome.

## Components

### Buttons (sidebar and shell)
- **Shape:** gently squared (6px), 1px transparent border, 7px × 10px padding, 13px text.
- **Default:** transparent, `text-primary`. **Hover:** `Hover Fill`. **Pressed:** `Sunken`. **Selected:** green tint with green text. **Error:** danger border and text. **Disabled:** 0.4 opacity. **Loading:** 0.6 opacity, no pointer events.
- **Focus:** `0 0 0 2px ground, 0 0 0 4px signal-green` (two-ring), via `:focus-visible` only.

### Tabs
- Quiet text-only tabs (`text-tertiary`, 13px, 180px max, ellipsised) divided by 1px hairlines. The active tab takes the `ground` background so it reads as attached to the editor, plus a 3px green inset underline and 600-weight text. A new note's tab plays one 900ms green pulse.

### Inputs
- 4px radius, `Hover Fill` background, `Hairline Strong` border, 13px text. Hover brightens the border to `text-tertiary`; focus uses the two-ring; error turns the border `danger`.

### Dialogs and Panels
- `Raised` background, `Hairline Strong` border, 10px radius, `Modal` shadow, 16px padding. Content renders through the plain `.settings-panel*` classes, not Tailwind utilities; `ui/dialog.tsx` only supplies overlay and positioning. Each plays one `surface-in` fade-and-settle on mount (no exit animation).

### Editor Content
- **Inline code:** `Hover Fill`, 3px radius, 2px × 5px padding. **Code block:** `Hover Fill`, 6px radius, 12px × 16px. **Callout:** 4px coloured left stripe, tinted background, `0 6px 6px 0` radius, per-variant colour (theorem, proof, algorithm, and so on).

### Motion
- `120ms` for state swaps (hover, press, toggle); `180ms` for a surface entering or a larger move. `ease-standard` (`cubic-bezier(0.4,0,0.2,1)`) for colour and position; `ease-out` (`cubic-bezier(0.16,1,0.3,1)`) for things settling into place. Entrance only. `prefers-reduced-motion` collapses everything to near-zero.

## Do's and Don'ts

### Do:
- **Do** read every colour, radius, shadow, duration from the `:root` tokens in `src/index.css`; the frontmatter mirrors them.
- **Do** use `Hairline Strong` for anything that is a bounded object (panel, input, card) and `Hairline` for dividers.
- **Do** give every interactive element all eight states: default, hover, pressed, `:focus-visible`, disabled, loading, error, selected.
- **Do** use `--focus-ring` for focus. It is the same everywhere.
- **Do** put non-prose text in `--font-mono` and sentences in `--font-sans`.
- **Do** grep `index.css` for the classNames a new dialog introduces before calling it done; an unmatched class renders unstyled.
- **Do** verify new rows and lists by screenshot against a neighbouring reference element, not by className existence.

### Don't:
- **Don't** introduce a second brand colour or a gradient.
- **Don't** add a fifth shadow tier or put a shadow on an in-layout panel.
- **Don't** use a coloured side stripe in app chrome; it is reserved for note content.
- **Don't** round chrome beyond 10px or use pill buttons.
- **Don't** use monospace for headings or body text.
- **Don't** animate on exit, overshoot, or animate a list that re-renders per keystroke.
- **Don't** use `--text-disabled` for text that must be read (3.4:1).
- **Don't** let a Tailwind utility fight an older unlayered selector: unlayered CSS always wins, so scope the old selector or point `className` at the existing class on purpose.
- **Don't** reset a dialog's centring with `transform`; Tailwind v4 uses `translate`/`scale`.
