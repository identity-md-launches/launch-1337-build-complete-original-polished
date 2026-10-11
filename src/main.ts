import './style.css';
import { AudioEngine } from './audio';
import { connectBridge } from './bridge';
import { Game, MAX_MULTIPLIER, type GameSummary } from './game';
import { loadBest, saveBest } from './storage';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const canvas = $<HTMLCanvasElement>('game');
const hud = $('hud');
const hudScore = $('hud-score');
const hudMulti = $('hud-multi');
const hudHearts = $('hud-lives');
const hudLivesText = $('hud-lives-text');
const frenzyBar = $('frenzy-bar');
const frenzyFill = $('frenzy-fill');
const screenStart = $('screen-start');
const screenPause = $('screen-pause');
const screenOver = $('screen-over');
const announcer = $('announcer');
const bestStart = $('best-start');
const overLine = $('over-line');
const overScore = $('over-score');
const overMulti = $('over-multi');
const overCaught = $('over-caught');
const overBest = $('over-best');

const btnStart = $<HTMLButtonElement>('btn-start');
const btnPause = $<HTMLButtonElement>('btn-pause');
const btnResume = $<HTMLButtonElement>('btn-resume');
const btnRestartPause = $<HTMLButtonElement>('btn-restart-pause');
const btnAgain = $<HTMLButtonElement>('btn-again');
const muteButtons = ['btn-mute-hud', 'btn-mute-start', 'btn-mute-pause', 'btn-mute-over'].map((id) => $<HTMLButtonElement>(id));

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const audio = new AudioEngine();
let best = loadBest();
let lastFocus: HTMLElement | null = null;

const bridge = connectBridge({
  pause: () => pauseGame(false),
  resume: () => {
    /* The player resumes explicitly so a hidden tab never un-pauses by itself. */
  },
});

const game = new Game(canvas, audio, {
  onScore(score, multiplier) {
    hudScore.textContent = String(score);
    hudMulti.textContent = `${multiplier}x`;
    hudMulti.classList.toggle('max', multiplier >= MAX_MULTIPLIER);
    bump(hudScore);
  },
  onLives(lives) {
    hudHearts.innerHTML = Array.from({ length: 3 }, (_, i) => `<span class="${i < lives ? 'alive' : 'lost'}">♥</span>`).join('');
    hudLivesText.textContent = `${lives} ${lives === 1 ? 'life' : 'lives'} left`;
  },
  onFrenzy(active, fraction) {
    frenzyBar.hidden = !active;
    frenzyFill.style.transform = `scaleX(${fraction})`;
  },
  onGameOver(summary) {
    showGameOver(summary);
  },
  onAnnounce(text) {
    announcer.textContent = text;
  },
});
game.reducedMotion = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener('change', () => {
  game.reducedMotion = reducedMotionQuery.matches;
});

/* ---------- helpers ---------- */

function bump(el: HTMLElement): void {
  if (game.reducedMotion) return;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
  window.setTimeout(() => el.classList.remove('bump'), 140);
}

function setMuted(muted: boolean): void {
  audio.setMuted(muted);
  for (const b of muteButtons) {
    b.setAttribute('aria-pressed', String(muted));
    if (b.classList.contains('icon-btn')) {
      b.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    } else {
      b.textContent = muted ? 'Unmute sound' : 'Mute sound';
    }
  }
}

function showOverlay(overlay: HTMLElement | null): void {
  for (const s of [screenStart, screenPause, screenOver]) {
    s.hidden = s !== overlay;
  }
  hud.hidden = game.phase === 'idle';
  if (overlay) {
    canvas.setAttribute('inert', '');
    hud.setAttribute('inert', '');
    const first = overlay.querySelector<HTMLElement>('.btn-primary');
    first?.focus({ preventScroll: true });
  } else {
    canvas.removeAttribute('inert');
    hud.removeAttribute('inert');
  }
}

function unlockAudio(): void {
  audio.unlock();
  audio.startMusic();
}

function startGame(): void {
  unlockAudio();
  game.start();
  audio.setPaused(false);
  showOverlay(null);
  announcer.textContent = 'Run started. Aim and snap to catch bugs.';
  btnPause.focus({ preventScroll: true });
  btnPause.blur();
}

function pauseGame(fromPlayer: boolean): void {
  if (game.phase !== 'playing') return;
  game.pause();
  audio.setPaused(true);
  lastFocus = fromPlayer ? btnPause : null;
  showOverlay(screenPause);
  announcer.textContent = 'Paused';
}

function resumeGame(): void {
  if (game.phase !== 'paused') return;
  unlockAudio();
  game.resume();
  audio.setPaused(false);
  showOverlay(null);
  announcer.textContent = 'Resumed';
  lastFocus?.focus({ preventScroll: true });
  lastFocus?.blur();
  lastFocus = null;
}

function showGameOver(summary: GameSummary): void {
  best = saveBest(summary.score);
  bridge.score(summary.score);
  overScore.textContent = String(summary.score);
  overMulti.textContent = `${summary.bestMultiplier}x`;
  overCaught.textContent = String(summary.caught);
  overBest.textContent = String(best);
  bestStart.textContent = `Best this device: ${best}`;
  const minutes = Math.floor(summary.elapsed / 60);
  const seconds = Math.floor(summary.elapsed % 60);
  overLine.textContent =
    summary.score >= best && summary.score > 0
      ? `New best. You lasted ${minutes}:${String(seconds).padStart(2, '0')} on the pond.`
      : `The wasps got you after ${minutes}:${String(seconds).padStart(2, '0')}.`;
  audio.setPaused(true);
  window.setTimeout(() => {
    if (game.phase === 'over') showOverlay(screenOver);
  }, 900);
  announcer.textContent = `Run over. Score ${summary.score}.`;
}

/* ---------- buttons ---------- */

btnStart.addEventListener('click', startGame);
btnAgain.addEventListener('click', startGame);
btnRestartPause.addEventListener('click', startGame);
btnResume.addEventListener('click', resumeGame);
btnPause.addEventListener('click', () => pauseGame(true));
for (const b of muteButtons) {
  b.addEventListener('click', () => {
    audio.unlock();
    setMuted(!audio.isMuted);
    game.sfx('ui');
  });
}
bestStart.textContent = `Best this device: ${best}`;

/* ---------- pointer input ---------- */

const pointer = { down: false, id: -1, type: 'mouse', x: 0, y: 0, downAt: 0, moved: false };

function toCanvas(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (e) => {
  if (game.phase === 'over' && screenOver.hidden) return;
  unlockAudio();
  const p = toCanvas(e);
  pointer.down = true;
  pointer.id = e.pointerId;
  pointer.type = e.pointerType;
  pointer.x = p.x;
  pointer.y = p.y;
  pointer.downAt = performance.now();
  pointer.moved = false;
  if (game.phase !== 'playing') return;
  canvas.setPointerCapture(e.pointerId);
  game.aimAt(p.x, p.y, e.pointerType === 'touch');
  if (e.pointerType === 'mouse') {
    game.snap(0.04);
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = toCanvas(e);
  if (e.pointerType === 'mouse' && !pointer.down) {
    if (game.phase === 'playing') game.aimAt(p.x, p.y, false);
    return;
  }
  if (!pointer.down || e.pointerId !== pointer.id) return;
  if (Math.hypot(p.x - pointer.x, p.y - pointer.y) > 6) pointer.moved = true;
  if (game.phase === 'playing') game.aimAt(p.x, p.y, e.pointerType === 'touch');
});

function endPointer(e: PointerEvent): void {
  if (!pointer.down || e.pointerId !== pointer.id) return;
  pointer.down = false;
  if (game.phase === 'playing' && e.pointerType !== 'mouse') {
    // Drag to aim, release to snap. A quick tap also aims at the tap point.
    game.snap(0.14);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------- keyboard ---------- */

const keys = new Set<string>();
const AIM_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  const onButton = target instanceof HTMLButtonElement;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    if (game.phase === 'playing') pauseGame(true);
    else if (game.phase === 'paused') resumeGame();
    return;
  }
  if (e.code === 'KeyM') {
    audio.unlock();
    setMuted(!audio.isMuted);
    return;
  }
  if (e.code === 'KeyR') {
    if (game.phase === 'playing' || game.phase === 'paused' || game.phase === 'over') {
      e.preventDefault();
      startGame();
    }
    return;
  }
  if (e.code === 'Enter' && game.phase === 'over' && !onButton) {
    startGame();
    return;
  }
  if (e.code in AIM_KEYS) {
    if (game.phase !== 'playing') return;
    e.preventDefault();
    keys.add(e.code);
    return;
  }
  if (e.code === 'Space') {
    if (onButton) return; // let the native button activate
    e.preventDefault();
    if (game.phase === 'playing') {
      unlockAudio();
      game.snap(0.08);
    } else if (game.phase === 'idle') {
      startGame();
    }
  }
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});
window.addEventListener('blur', () => {
  keys.clear();
  pauseGame(false);
});

/* ---------- gamepad ---------- */

let padSnapHeld = false;
let padPauseHeld = false;
function pollGamepad(): void {
  if (!('getGamepads' in navigator)) return;
  let pads: (Gamepad | null)[] = [];
  try {
    pads = Array.from(navigator.getGamepads());
  } catch {
    return;
  }
  const pad = pads.find((p): p is Gamepad => !!p && p.connected);
  if (!pad) return;
  const rx = pad.axes[2] ?? 0;
  const ry = pad.axes[3] ?? 0;
  const lx = pad.axes[0] ?? 0;
  const ly = pad.axes[1] ?? 0;
  const ax = Math.abs(rx) + Math.abs(ry) > 0.3 ? rx : lx;
  const ay = Math.abs(rx) + Math.abs(ry) > 0.3 ? ry : ly;
  if (game.phase === 'playing' && Math.hypot(ax, ay) > 0.3) game.aimDirection(ax, ay);
  const snapPressed = !!(pad.buttons[0]?.pressed || pad.buttons[2]?.pressed || pad.buttons[7]?.pressed);
  if (snapPressed && !padSnapHeld) {
    unlockAudio();
    if (game.phase === 'playing') game.snap(0.14);
    else if (game.phase === 'idle' || game.phase === 'over') {
      if (game.phase === 'idle' || !screenOver.hidden) startGame();
    } else if (game.phase === 'paused') resumeGame();
  }
  padSnapHeld = snapPressed;
  const pausePressed = !!pad.buttons[9]?.pressed;
  if (pausePressed && !padPauseHeld) {
    if (game.phase === 'playing') pauseGame(true);
    else if (game.phase === 'paused') resumeGame();
  }
  padPauseHeld = pausePressed;
}

/* ---------- loop ---------- */

function applyKeyboardAim(): void {
  if (keys.size === 0) return;
  let dx = 0;
  let dy = 0;
  for (const k of keys) {
    const v = AIM_KEYS[k];
    if (v) {
      dx += v[0];
      dy += v[1];
    }
  }
  if (dx !== 0 || dy !== 0) game.aimDirection(dx, dy);
}

let last = performance.now();
function frame(now: number): void {
  const dt = (now - last) / 1000;
  last = now;
  pollGamepad();
  applyKeyboardAim();
  game.update(dt);
  game.render();
  requestAnimationFrame(frame);
}

const resizeObserver = new ResizeObserver(() => game.resize());
resizeObserver.observe(canvas);
window.addEventListener('orientationchange', () => window.setTimeout(() => game.resize(), 120));

if (window.location.hash === '#debug') {
  // Verification hook for the Playwright script in test/; not used by players.
  (window as unknown as { __tongueRush: unknown }).__tongueRush = {
    game,
    audioState: () => audio.state,
    bridgeConnected: () => bridge.connected,
  };
}

showOverlay(screenStart);
game.resize();
requestAnimationFrame(frame);
