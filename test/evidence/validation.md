# Tongue Rush: validation and Better Interface review

Worker-side record for this build. It is the worker's report, not an independent
certification. Machine-readable results: `artifacts/validation-results.json`; screenshots:
`artifacts/screenshots/`. A committed copy of this record, the results JSON and the
screenshots lives in `test/evidence/`.

## 1. Scope and assumptions

- Product: one-page HTML5 arcade game (`dist/index.html`), with start, play, pause, game-over
  states, HUD, and the `pepe-game/1` iframe bridge. Export location: `dist/` (committed),
  manifest `dist/pepe-game.json`, cover `dist/cover.png` (1200×630).
- Stack chosen: Vite + TypeScript + Canvas 2D + Web Audio, no runtime dependencies (the
  assignment asked for the smallest suitable stack; React was not needed for a canvas game).
- Inferred choices: endless mode with difficulty rising over about three minutes; multiplier
  raised by fireflies and every four clean snaps, decaying slowly when idle; Frenzy = 7 s at
  0.45× world speed and 3× score with no wasps; near-miss bonus = 40 × multiplier per wasp
  passed within 30 px without touching; wasps only cost a life when the tongue touches them
  (per the brief); no leaderboard, wallet, login or payments.
- Variants: light scheme only (the night scene is the brand); reduced-motion variant
  implemented. No localization, no dark/light toggle. RTL mirroring not applicable (no
  reading-order dependent layout beyond centred panels; logical properties are used).
- Exclusions: no screen-reader session, no physical device, no real gamepad, no Firefox/Safari.

## 2. Coverage (six domains)

| Domain | Status | Inspected / evidence |
| --- | --- | --- |
| Accessibility | Checked | Native `<button>`s everywhere; `:focus-visible` 3 px gold outline measured in-browser (`desktop-pause-focus.png`); panels set `inert` on canvas/HUD, focus moves to the primary button and returns to the pause button (automated); `role="status"` live region; `aria-pressed` + label on mute; hearts have a visually hidden text twin; 44 px targets measured at 390 wide; `prefers-reduced-motion` honoured (CSS and canvas, emulated). Not performed: screen-reader session, browser-native 200 % zoom (narrow viewports are not zoom), forced-colors mode. |
| Layout | Checked | 1280×800, 1024×700, 390×844, 320×568 screenshots; no horizontal overflow at 390 and 320 (measured `scrollWidth`); product + main action on the first screen at 390 (Start button bottom at 381 px); logical properties and safe-area insets in source. Not performed: RTL mirror, 200 % zoom. |
| Writing | Checked (source) | Verb-first buttons (Start game, Resume, Restart run, Play again, Mute sound/Unmute sound); one capitalization policy (sentence case); directions sit next to the controls; no "oops"/exclamation errors (there are no error states beyond game over copy). |
| Typography | Checked | Two fonts, six sizes, weights 400/700/800 only; `document.fonts.check` confirmed both faces loaded from the inlined data; tabular numerals on changing values; `text-wrap: balance/pretty`; rendered wrapping inspected at 320/390/1280. |
| Colors | Checked | Token system in `src/style.css` (hue primitives → role tokens); contrast computed for the pairs listed in `DESIGN.md` (all ≥ 5.9:1 on the composited panel/sky). Limitation: the panel is translucent over a blurred moving scene, so rendered backgrounds vary; values were computed from tokens against the composited mid-pond colour, not sampled from screenshots. |
| UI | Checked | Named transition properties, 120/220 ms, `cubic-bezier(0.2,0,0,1)`, `scale(0.96)` press, concentric radii (24 px panel / 14 px tiles / pills), `currentColor` SVG icons swapped by state, static cue for every animated event. Not performed: Animations-panel replay at 10 % speed. |

## 3. Findings and fixes

| # | Sev | Where | Evidence | Fix | Recheck |
| --- | --- | --- | --- | --- | --- |
| 1 | HIGH | `vite.config.ts`, `index.html` (build output) | In the sandboxed-iframe harness the module script, stylesheet and fonts failed with CORS errors from the opaque origin when the static server sent no `Access-Control-Allow-Origin` (first verify run: 4 iframe checks failed). | Build as a classic deferred IIFE script, strip `crossorigin`, inline fonts into the CSS (`assetsInlineLimit`), single CSS file. | Verify run 2 and 3: 34/34 pass, iframe handshake, pause, storage denial and score message confirmed. |
| 2 | LOW | `src/game.ts` `drawSky()` | `desktop-start.png` (first run): horizon reeds rendered as an evenly spaced row of straight sticks, reading as a fence. | Reeds now cluster near both banks with curved stems, varied thickness and seed heads. | Final screenshots (`desktop-hurt.png`, `desktop-start.png`). |
| 3 | LOW | `src/game.ts` `drawWater()` | First-run screenshots: the moon reflection was a ladder of identical ellipses. | Fewer streaks with eased spacing, varied width, wobble and alpha. | Final screenshots. |
| 4 | LOW | `src/game.ts`, `src/style.css` | Reduced-motion users still received screen shake/particles (source review). | `Game.reducedMotion` gate: no shake, particles ÷3, flash dimmed, no text pop; CSS removes panel entrance and HUD bump. | Automated reduced-motion check passes. |

No open HIGH or MEDIUM findings remain.

## 4. Verification

Commands (all run from the repo root on 2026-10-11, exit codes as stated):

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0, no errors |
| `npx vite build` | exit 0; `dist/index.html` 6.4 kB, `assets/style-*.css` 86 kB (fonts inlined), `assets/index-*.js` 38.5 kB |
| `node test/check-dist.mjs` | all dist checks passed (manifest fields, relative URLs, metadata, cover 1200×630, no network loads) |
| `node test/verify.mjs` | 34/34 checks passed (headless Chromium 1246 via playwright-core 1.64.0-alpha; own static server; dist served under `/preview/`) |

Browser interactions exercised (see `validation-results.json` for each check and detail):
head metadata and favicon; fonts loaded; start screen at 1280/390/320 with Start on the first
screen and no overflow; initial focus; mouse aim + click catch; firefly → 2x; rainbow → Frenzy
bar; Escape pause with focus on Resume; Tab to next button with measured focus ring; Escape
resume; ArrowLeft + Space catch; wasp → 2 lives and 1x; three wasp hits → game over panel
focused on Play again; R → instant restart; M → mute state on all buttons; window blur →
pause; touch tap catch and CDP touch drag-release catch at 390 wide; HUD pause button; reduced
motion; sandboxed iframe (`allow-scripts allow-pointer-lock`) init/ready handshake, pause on
the right channel, ignore the wrong channel, `localStorage` blocked without errors, integer
score message at game over; zero console errors and zero failed resource loads.

Screenshots: `desktop-start.png`, `desktop-frenzy.png`, `desktop-pause.png`,
`desktop-pause-focus.png`, `desktop-hurt.png`, `desktop-gameover.png`,
`desktop-1024-reduced-motion.png`, `mobile-390-start.png`, `mobile-390-play.png`,
`mobile-390-pause.png`, `mobile-320-start.png`, `iframe-sandbox-gameover.png`.

Audio: the AudioContext state was confirmed `running` after the Start gesture (headless
Chromium runs with audio muted, so the sounds were not listened to).

## 5. Completion

**Complete for the stated scope.** Remaining limitations: Chromium only; emulated touch and
no physical phone; gamepad path reviewed in source only (no controller available); no
screen-reader or native-zoom session; contrast computed from tokens rather than sampled from
the translucent rendered panel; the sandbox harness in `test/sandbox.html` approximates the
arcade player rather than being the real one. The Swarm publishes the hosted site after this
build; no submission or approval is claimed here.
