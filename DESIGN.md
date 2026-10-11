# Tongue Rush design system

Extracted from the final source (`src/style.css`, `src/game.ts`, `index.html`) and confirmed
against the rendered export in `artifacts/screenshots/`.

## Overview

Tongue Rush is a single-screen arcade game for players on phones, laptops and gamepads. The
visual identity is "moonlit pond, premium cartoon": a deep navy night sky over a blue pond,
a mint-green Pepe with a pink tongue, glowing gold fireflies, and cream text. The canvas
scene bleeds edge to edge; all controls and copy live in rounded, translucent navy panels
floating above it. Hierarchy comes from one chunky rounded display face (Baloo 2) for titles,
numbers and buttons, and a humanist sans (Nunito) for everything else. The density is relaxed:
one primary action per panel, generous 16 to 24 px spacing, and 44 px minimum touch targets.

System-wide rules: tokens below, the two fonts, the panel/button/HUD components, the motion
rules. One-page arrangements that are not rules: the start panel's control list and legend, the
2x2 stats grid on the game-over panel.

## Colors

All tokens are CSS custom properties on `:root` in `src/style.css` (hex notation). Primitives
are named by hue and never used directly in components; semantic tokens name the job.

| Role token | Value | Use |
| --- | --- | --- |
| `--color-bg-page` | `--navy-900` `#0b1a3a` | page background behind the canvas, theme-color |
| `--color-bg-surface` | `rgba(11,26,58,0.86)` | panels, icon buttons (translucent over the pond) |
| `--color-bg-surface-strong` | `#10224a` | icon button hover |
| `--color-border-surface` | `rgba(169,240,198,0.22)` | 1 px inset ring on panels, ghost button outline |
| `--color-text-primary` | `--cream-100` `#fbf6e6` | body text, HUD values, ghost button labels |
| `--color-text-secondary` | `--mist-300` `#b8c8ea` | ledes, captions, HUD labels, stat labels |
| `--color-text-on-accent` | `--navy-950` `#060e22` | label on the filled primary button |
| `--color-accent-solid` / `-hover` | `--mint-400` `#6fd49c` / `--mint-300` `#a9f0c6` | the one filled action per panel |
| `--color-accent-text` | `--mint-300` `#a9f0c6` | kicker and titles |
| `--color-focus-ring` | `--gold-400` `#ffd166` | `:focus-visible` outline, also the multiplier value |
| `--color-frenzy` | `--pink-400` `#ff6f9c` | hearts, 12x multiplier state, tongue |

Canvas palette (`COLORS` in `src/game.ts`): tongue `#ff6f9c` / `#d94f7c`, Pepe mint
`#a9f0c6` → `#6fd49c` → `#3fb77a`, lily pads `#4fbf85` → `#2a8a5b`, fly `#c9d6ff`, firefly
gold `#ffd166`, wasp `#ffd166` with `#1b1b1b` stripes and a red `#ff5c5c` halo, sky gradient
`#070f2a` → `#0e2150` → `#15397a`, water `#0f2a5e` → `#17407f`. Rainbow bugs cycle `hsl()`
hue at runtime; it is the only place a second notation appears.

Meaning rules: mint = Pepe and the primary action; gold = reward (fireflies, multiplier,
focus); pink = tongue, lives and the maxed multiplier; red halo = danger (wasps). Only one
filled button per panel.

Measured WCAG 2 contrast (computed from token values; the panel is composited as
`rgba(11,26,58,.86)` over the mid-pond blue `#15397a` = `#0c1e43`): primary text 15.2:1,
secondary text 9.7:1, accent text 12.5:1, gold 11.4:1, button label on mint 10.6:1, HUD
label on sky 9.2:1, hearts on sky 5.9:1. The panel sits over a blurred, varying scene, so
real backgrounds differ slightly; see `artifacts/validation.md`.

## Typography

- `--font-display`: `"Baloo 2"` 800, local woff2 (`src/fonts/baloo2-800-latin.woff2`,
  latin subset, inlined into the built CSS). Used for the game title, panel headings, HUD
  values, stat values, buttons and all canvas floating text (`FONT_DISPLAY` in `game.ts`).
- `--font-body`: `"Nunito"` variable 200–1000 (`src/fonts/nunito-variable-latin.woff2`);
  weights used are 400 and 700. Used for ledes, captions, labels, control hints.
- Fallback stacks end in `system-ui, sans-serif`. Root has antialiased font smoothing.

Type scale (six sizes, `:root`):

| Token | Size | Role |
| --- | --- | --- |
| `--text-caption` | 0.8125rem (13 px) | HUD labels, control list, legend, hints, stat labels |
| `--text-body` | 1rem | body default, ghost buttons |
| `--text-lead` | 1.125rem | ledes, primary button |
| `--text-hud` | 1.375rem | HUD values, hearts |
| `--text-heading` | 1.75rem | pause / game-over headings (`.title-sm`), stat values |
| `--text-display` | `clamp(2.5rem, 9vw, 4.25rem)` | game title only (`.title`) |

Line heights: display/headings 1.05–1.1, HUD values 1.1, body 1.5. The title uses
`letter-spacing: -0.02em` and `text-wrap: balance`; ledes use `text-wrap: pretty`. Every
changing number (`.hud-value`, `.stats dd`, `.best`) uses `font-variant-numeric: tabular-nums`.
Key caps (`.key`) are bold 700 pills with `white-space: nowrap`.

## Layout

- The canvas is `position: absolute; inset: 0` inside the fixed `.app`; the page never scrolls.
  The game computes a scale factor from `min(width, height) / 640` (clamped 0.62–1.3) so Pepe,
  bugs and text size with the viewport; Pepe sits at 58 % (landscape) or 60 % (portrait) of
  the height; tongue reach is 44 % of the smaller side (150–380 px).
- Spacing tokens `--space-1` … `--space-6` (4, 8, 12, 16, 24, 32 px). Panels pad 24 px (16 px
  under 30 rem). Groups are separated by 24 px, items within a group by 8 px.
- HUD (`.hud`): a 4-column grid (score, multiplier, lives, actions) pinned to the top with
  `env(safe-area-inset-*)` offsets; the Frenzy bar spans all columns on a second row,
  max width 420 px. Pointer events are off except on the action buttons.
- Panels (`.panel`) are centred with `display: grid; place-items: center`, `width: min(100%,
  30rem)`, and the overlay scrolls if the viewport is shorter than the panel. Under 36 rem
  height the panel aligns to the top instead of the centre.
- Breakpoints come from content: 30 rem (panel padding, HUD gap) and 36 rem height. Logical
  properties (`inset-inline`, `margin-block-start`) are used for direction-dependent spacing.
- Verified in the browser at 1280×800, 1024×700, 390×844 and 320×568.

## Elevation & depth

Flat surfaces with one shadow recipe: `--shadow-surface` (a 1 px white 6 % ring plus a soft
`0 18px 40px` navy drop) on panels and icon buttons, and `--shadow-accent` (mint glow) on the
primary button. Overlays add a `rgba(6,14,34,.45)` scrim (`.25` on the start screen so the
pond stays visible) with a 2 px backdrop blur. The canvas layers back to front: sky and stars,
moon and halo, reed silhouettes, water with moon reflection and ripples, lily pads, ambient
fireflies, aim guide, tongue, Pepe, bugs, particles, floating text, then a vignette (or the
rotating-hue Frenzy vignette) and a flash layer.

## Shapes

Radii: `--radius-sm` 8 px (key caps), `--radius-md` 14 px (stat tiles), `--radius-lg` 24 px
(panels), `--radius-pill` for buttons, icon buttons and bars. Everything in the scene is round
or elliptical: lily pads are flattened discs with a notch, bugs are ellipses with translucent
wings, the tongue is a stroked quadratic curve with a round tip.

## Components

- **Primary button** `.btn.btn-primary` (`index.html`, styled in `style.css`): filled mint,
  display font, min height 48 px, min width 12 rem, `scale(0.96)` on press, hover tint only
  under `@media (hover: hover)`. One per panel; receives focus when its panel opens.
- **Ghost button** `.btn.btn-ghost`: transparent with the surface ring, body font, 44 px min
  height. Mute buttons use `aria-pressed` and switch their label between "Mute sound" and
  "Unmute sound"; the pressed state tints gold.
- **Icon button** `.icon-btn`: 44×44 pill on the surface colour with an inline SVG using
  `currentColor`; the HUD mute button swaps its two icons by `aria-pressed`, and has an
  `aria-label` that tracks the state.
- **Panel** `.overlay > .panel`: centred card with kicker, title, lede, actions. Opening a
  panel sets `inert` on the canvas and HUD and focuses the primary button; closing restores
  focus to the pause button. Panels fade/slide in 220 ms only under
  `prefers-reduced-motion: no-preference`.
- **HUD group** `.hud-group` (label over value), **hearts** `.hud-hearts` with `.lost` for
  spent lives and a visually hidden text twin for assistive tech, **Frenzy bar**
  `.frenzy-bar/.frenzy-fill` scaled by `transform: scaleX()`.
- **Key cap** `.key` and **legend dot** `.dot-*` are presentational helpers for the start panel.
- **Status region** `#announcer` (`role="status"`, polite) carries run start, pause, frenzy,
  life loss and game-over announcements.

## Motion

Transitions name their properties (`transform`, `background-color`, `color`) at
`--duration-fast` 120 ms / `--duration-base` 220 ms with `--ease-standard`
`cubic-bezier(0.2, 0, 0, 1)`. In the game, `Game.reducedMotion` (from
`prefers-reduced-motion`) disables screen shake, cuts particle bursts to a third, dims flashes
and removes the text pop; the CSS media query removes the panel entrance and HUD bump. Every
animated event also has a static cue (score text, hearts, bar, announcer text).

## Do's and don'ts

- Start a new panel from `.overlay > .panel`, give it one `.btn-primary` and any number of
  `.btn-ghost`, and focus the primary button when it opens.
- Use semantic tokens (`--color-text-secondary`), never the hue primitives, in components.
  Add a role token if a new role appears rather than borrowing a near value.
- Keep new text sizes inside the six-step scale; put changing numbers in the display font
  with tabular numerals.
- Keep gold for rewards and focus, pink for tongue/lives/max state, mint for the primary
  action. Do not introduce a second filled button in a panel.
- Any new animation needs a reduced-motion branch and a non-motion cue.
- Recipe for another screen (for example a settings panel): add a `<section class="overlay"
  hidden aria-labelledby=…>` with a `.panel`, a `.title.title-sm` heading, a `.lede`, a
  `.btn-row` of buttons, register it in `showOverlay()` in `src/main.ts`, and reuse the
  existing tokens; no new CSS values should be necessary.
