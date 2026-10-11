# Tongue Rush

A moonlit pond arcade game for the Pepe2Pepe arcade. Pepe sits on a lily pad in the
middle of the pond; bugs cross the sky in rhythmic patterns and you aim and snap his
tongue to catch them. Three lives, endless rounds, instant restart.

- **Flies** score points.
- **Golden fireflies** raise the multiplier (up to 12x). Four clean snaps in a row also raise it.
- **Rainbow bugs** start Frenzy Mode: seven seconds of slow motion and triple score, no wasps.
- **Wasps** break the multiplier and cost a life if the tongue touches them. Passing close
  by without touching earns a "Close call" style bonus.
- Catching several bugs in one snap earns a chain bonus. The multiplier slowly decays if you
  stop catching, so the flow never stalls.

## How to play

| Device | Aim | Snap | Pause / restart / mute |
| --- | --- | --- | --- |
| Mouse | move the pointer | left click or Space | Esc or P, R, M |
| Keyboard | WASD or arrow keys (aim turns smoothly) | Space | Esc or P, R, M |
| Touch | drag anywhere on the pond | release, or just tap | HUD pause button; restart from the pause panel |
| Gamepad | right stick (left stick also works) | A / X / right trigger | Start pauses |

The dotted line and small ring show where the tongue will land; the faint circle is the
tongue's reach. On touch and gamepad a small aim assist nudges the snap toward the nearest
bug (never toward a wasp). Switching tabs or losing window focus pauses the game.

## Stack

Vite 7 + TypeScript (strict), plain Canvas 2D, Web Audio API. There are no runtime
dependencies: all art is drawn with canvas paths, and every sound and the background music
are synthesized at runtime, so nothing is fetched from the network. Two SIL OFL fonts
(Baloo 2, Nunito) are bundled from `src/fonts/` and inlined into the stylesheet.

```
index.html          page shell: canvas, HUD, start / pause / game-over panels, metadata
src/main.ts         input (pointer, keyboard, gamepad), HUD + overlays, loop, bridge wiring
src/game.ts         simulation and rendering (bugs, tongue, scoring, frenzy, particles)
src/audio.ts        synthesized sound effects and the generative pond music loop
src/bridge.ts       pepe-game/1 iframe bridge (init / ready / pause / resume / score)
src/storage.ts      best score with guarded localStorage (falls back to memory in the sandbox)
src/style.css       design tokens, HUD and panel styles
public/             pepe-game.json manifest, cover.png (1200x630), favicon.svg
test/verify.mjs     end-to-end verification (own static server + headless Chromium)
test/check-dist.mjs static export integrity check
test/cover.html     source of the cover image
dist/               committed production export (what gets published)
```

## Install, preview, rebuild, publish

```sh
npm install                 # installs vite + typescript (pinned, lockfile committed)
npm run dev                 # dev server with hot reload
npm run build               # production export into dist/ (base './', relative URLs)
npm run preview             # serve the built dist/ locally
npm run typecheck           # tsc --noEmit
npm run check               # static checks of dist/ (manifest, metadata, relative assets)
node test/verify.mjs        # browser verification, see "Testing" below
node test/verify.mjs --cover  # re-render public/cover.png from test/cover.html, then rebuild
```

Publishing: the committed `dist/` folder is the release. It contains `index.html`,
`pepe-game.json` (schema `pepe-browser-game/1`), `cover.png`, `favicon.svg` and `assets/`.
Every URL is relative, so the folder works from an IPFS gateway subpath, an ENS name or a
plain static host. After this Swarm build completes, the Swarm pins `dist/` and the
coordinating agent runs the template repository's release helper outside this build to
submit the published CID for admin review. This build does not submit anything and makes no
claim of approval.

### Sandbox notes

The arcade loads the game in an iframe with `sandbox="allow-scripts allow-pointer-lock"`
(opaque origin, no storage). Because module scripts and `@font-face` loads are always CORS
requests, the export ships a classic deferred script with no `crossorigin` attributes and
inlines the fonts, so it loads even from a host that sends no `Access-Control-Allow-Origin`
header (see `vite.config.ts`). `localStorage` failures are caught and the best score is kept
in memory for the session. Audio starts on the first gesture (Start button, click, tap, key).

## Testing

`node test/verify.mjs` is one bounded foreground command: it starts a throwaway static server
(serving `dist/` under `/preview/` so relative URLs are exercised at a subpath), drives
headless Chromium through Playwright, writes screenshots to `artifacts/screenshots/` and the
machine-readable results to `artifacts/validation-results.json`, then exits. The `artifacts/`
folder is delivered separately by the Swarm daemon; a committed copy of the same evidence
lives in `test/evidence/` (screenshots, results JSON and the validation record). It needs a local
Playwright library and Chromium; set `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_CHROME` if yours are
not at the defaults used in the script.

Last run on 2026-10-11 (Chromium 1246 build via playwright-core 1.64.0 alpha): **34 / 34
checks passed**. Build (`vite build`) and `tsc --noEmit` both exit 0; `npm run check` passes.
The full evidence record, Better Interface review coverage, findings and limitations are in
[`test/evidence/validation.md`](test/evidence/validation.md) (delivery copy:
`artifacts/validation.md`). Design tokens and components are
documented in [`DESIGN.md`](DESIGN.md).

What the browser run covers: head metadata and favicon; start screen at 1280, 390 and 320
wide (product and Start button on the first screen, no horizontal overflow, 44 px targets);
mouse aim + click, keyboard aim + Space, touch tap and touch drag-release (CDP touch events);
fly / firefly / rainbow / wasp outcomes (score, multiplier, Frenzy, lives, multiplier reset);
pause via Escape and the HUD button with focus moving into the panel and back; game over
after three wasp hits; instant restart with R; mute toggle state across all mute buttons;
pause on window blur; reduced-motion emulation; a sandboxed iframe harness that performs the
`pepe-game/1` init/ready handshake, sends pause on the right and wrong channel, confirms
`localStorage` is blocked without errors, and receives an integer score message at game over;
console errors and failed resource loads (none).

Known limitations: the run uses headless Chromium only (no Firefox/Safari, no physical
phone, no real gamepad: gamepad handling was reviewed in source only); audio was confirmed as
a running AudioContext after a gesture but not listened to; the automated flows use a test
hook (`#debug` hash) to place bugs at known positions instead of waiting for random spawns.
No screen-reader session was run; the accessibility tree was inspected via Playwright only.

## Licenses

Game code and art: original work for this submission. Fonts: Baloo 2 and Nunito, SIL Open
Font License 1.1 (`src/fonts/LICENSE.txt`). No third-party runtime code is bundled.
