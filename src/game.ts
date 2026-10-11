/**
 * Tongue Rush core: simulation + Canvas 2D rendering.
 *
 * The world is measured in CSS pixels of the canvas. Pepe sits at a fixed anchor;
 * bugs follow parametric paths that are generated relative to Pepe's reach so
 * every bug is catchable on every screen size. All motion is scaled by dt, so the
 * game is frame-rate independent. Frenzy slows world time without slowing the
 * tongue or the player.
 */
import type { AudioEngine, Sfx } from './audio';

export type BugKind = 'fly' | 'firefly' | 'rainbow' | 'wasp';
export type Phase = 'idle' | 'playing' | 'paused' | 'over';

interface Vec {
  x: number;
  y: number;
}

interface Bug {
  kind: BugKind;
  x: number;
  y: number;
  r: number;
  t: number; // path time (seconds)
  life: number; // seconds until despawn
  path: (t: number) => Vec;
  wing: number;
  hue: number;
  caught: boolean;
  nearMissed: boolean;
  dead: boolean;
  vx: number;
  vy: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  glow: boolean;
  gravity: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
}

interface Ripple {
  x: number;
  y: number;
  r: number;
  max: number;
  life: number;
  speed: number;
}

export interface GameEvents {
  onScore(score: number, multiplier: number): void;
  onLives(lives: number): void;
  onFrenzy(active: boolean, fraction: number): void;
  onGameOver(summary: GameSummary): void;
  onAnnounce(text: string): void;
}

export interface GameSummary {
  score: number;
  bestMultiplier: number;
  caught: number;
  elapsed: number;
}

export const MAX_MULTIPLIER = 12;
const FRENZY_DURATION = 7;
const FRENZY_TIME_SCALE = 0.45;
const FRENZY_SCORE_MULT = 3;
const TONGUE_OUT = 0.13;
const TONGUE_HOLD = 0.05;
const TONGUE_BACK = 0.15;
const POINTS: Record<BugKind, number> = { fly: 10, firefly: 50, rainbow: 100, wasp: 0 };

const COLORS = {
  tongue: '#ff6f9c',
  tongueDark: '#d94f7c',
  mint: '#6fd49c',
  mintLight: '#a9f0c6',
  mintDark: '#3fb77a',
  cream: '#fbf6e6',
  gold: '#ffd166',
  amber: '#ffb347',
  navy: '#0b1a3a',
  fly: '#c9d6ff',
  wasp: '#ffd166',
  waspDark: '#1b1b1b',
  danger: '#ff5c5c',
} as const;

const FONT_DISPLAY = '"Baloo 2", "Arial Rounded MT Bold", "Segoe UI", system-ui, sans-serif';

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return Math.hypot(px - cx, py - cy);
}

export class Game {
  phase: Phase = 'idle';
  score = 0;
  multiplier = 1;
  bestMultiplier = 1;
  lives = 3;
  caught = 0;
  elapsed = 0;
  reducedMotion = false;

  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private pepe: Vec = { x: 0, y: 0 };
  private reach = 240;
  private scale = 1;

  private aim = -Math.PI / 2;
  private aimTarget = -Math.PI / 2;
  private showReticle = false;

  private tongue = { active: false, t: 0, len: 0, angle: 0, hitWasp: false, catches: 0, nearMisses: 0 };
  private snapCooldown = 0;
  private hurtTimer = 0;
  private frenzyTimer = 0;
  private rainbowCooldown = 18;
  private spawnTimer = 1.2;
  private idleTimer = 0;
  private streak = 0;
  private shake = 0;
  private flash = { color: '#ffffff', alpha: 0 };
  private time = 0;

  private bugs: Bug[] = [];
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private ripples: Ripple[] = [];
  private stars: { x: number; y: number; r: number; p: number }[] = [];
  private ambient: { x: number; y: number; p: number; s: number }[] = [];
  private pads: { x: number; y: number; r: number; rot: number; p: number }[] = [];
  private rippleTimer = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly audio: AudioEngine,
    private readonly events: GameEvents,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.resize();
  }

  /* ---------- lifecycle ---------- */

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const m = Math.min(this.w, this.h);
    this.scale = clamp(m / 640, 0.62, 1.3);
    this.pepe = { x: this.w / 2, y: this.h * (this.h > this.w ? 0.6 : 0.58) };
    this.reach = clamp(m * 0.44, 150, 380);
    this.seedScenery();
  }

  start(): void {
    this.phase = 'playing';
    this.score = 0;
    this.multiplier = 1;
    this.bestMultiplier = 1;
    this.lives = 3;
    this.caught = 0;
    this.elapsed = 0;
    this.streak = 0;
    this.bugs = [];
    this.particles = [];
    this.texts = [];
    this.tongue.active = false;
    this.snapCooldown = 0;
    this.hurtTimer = 0;
    this.frenzyTimer = 0;
    this.rainbowCooldown = 16;
    this.spawnTimer = 0.8;
    this.idleTimer = 0;
    this.audio.setFrenzy(false);
    this.events.onScore(0, 1);
    this.events.onLives(3);
    this.events.onFrenzy(false, 0);
  }

  pause(): void {
    if (this.phase === 'playing') this.phase = 'paused';
  }

  resume(): void {
    if (this.phase === 'paused') this.phase = 'playing';
  }

  /* ---------- input ---------- */

  /** Aim at a point in canvas CSS pixels. */
  aimAt(x: number, y: number, reticle = false): void {
    const dx = x - this.pepe.x;
    const dy = y - this.pepe.y - 10 * this.scale;
    if (Math.hypot(dx, dy) < 6) return;
    this.aimTarget = Math.atan2(dy, dx);
    this.aim = this.aimTarget; // pointer aim is immediate
    this.showReticle = reticle;
  }

  /** Aim by direction vector (keyboard/gamepad); the aim turns smoothly. */
  aimDirection(dx: number, dy: number): void {
    if (Math.hypot(dx, dy) < 0.2) return;
    this.aimTarget = Math.atan2(dy, dx);
    this.showReticle = true;
  }

  /** Snap the tongue toward the current aim. Returns false if the snap was refused. */
  snap(assistRadians = 0): boolean {
    if (this.phase !== 'playing' || this.tongue.active || this.snapCooldown > 0 || this.hurtTimer > 0.5) return false;
    let angle = this.aim;
    if (assistRadians > 0) {
      // Gentle aim assist: nudge toward the closest non-wasp bug within the cone.
      let best = assistRadians;
      let bestAngle = angle;
      for (const b of this.bugs) {
        if (b.kind === 'wasp' || b.caught) continue;
        const d = Math.hypot(b.x - this.pepe.x, b.y - this.pepe.y);
        if (d > this.reach + b.r) continue;
        const a = Math.atan2(b.y - this.pepe.y, b.x - this.pepe.x);
        let diff = Math.abs(a - angle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff < best) {
          best = diff;
          bestAngle = a;
        }
      }
      angle = bestAngle;
    }
    this.tongue = { active: true, t: 0, len: 0, angle, hitWasp: false, catches: 0, nearMisses: 0 };
    this.audio.play('snap');
    this.ripples.push({ x: this.pepe.x, y: this.pepe.y + 26 * this.scale, r: 8, max: 70 * this.scale, life: 1, speed: 90 });
    return true;
  }

  /* ---------- simulation ---------- */

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.rippleTimer -= dt;
    if (this.rippleTimer <= 0) {
      this.rippleTimer = rand(0.8, 2.2);
      this.ripples.push({ x: rand(0, this.w), y: rand(this.h * 0.35, this.h), r: 2, max: rand(40, 110) * this.scale, life: 1, speed: 28 });
    }
    this.updateScenery(dt);

    if (this.phase === 'paused' || this.phase === 'idle') {
      this.updateCosmetics(dt);
      if (this.phase === 'idle') this.updateAttract(dt);
      return;
    }

    // Smooth aim for keyboard / gamepad.
    let diff = this.aimTarget - this.aim;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.aim += diff * Math.min(1, dt * 18);

    if (this.phase === 'over') {
      this.updateCosmetics(dt);
      this.updateBugs(dt * 0.6, false);
      return;
    }

    this.elapsed += dt;
    this.snapCooldown = Math.max(0, this.snapCooldown - dt);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);

    if (this.frenzyTimer > 0) {
      this.frenzyTimer -= dt;
      this.events.onFrenzy(true, clamp(this.frenzyTimer / FRENZY_DURATION, 0, 1));
      if (this.frenzyTimer <= 0) {
        this.frenzyTimer = 0;
        this.audio.setFrenzy(false);
        this.audio.play('frenzyEnd');
        this.events.onFrenzy(false, 0);
        this.events.onAnnounce('Frenzy over');
      }
    }
    this.rainbowCooldown -= dt;

    // Multiplier decays slowly when the player stops catching.
    this.idleTimer += dt;
    if (this.idleTimer > 5 && this.multiplier > 1 && this.frenzyTimer <= 0) {
      this.multiplier -= 1;
      this.idleTimer = 2.5;
      this.events.onScore(this.score, this.multiplier);
    }

    const worldDt = this.frenzyTimer > 0 ? dt * FRENZY_TIME_SCALE : dt;
    this.spawnTimer -= this.frenzyTimer > 0 ? dt * 1.6 : dt;
    if (this.spawnTimer <= 0) {
      this.spawnWave();
    }

    this.updateBugs(worldDt, true);
    this.updateTongue(dt);
    this.updateCosmetics(dt);
  }

  private difficulty(): number {
    // 0 at start, approaches 1 over ~3 minutes, keeps creeping afterwards.
    return Math.min(1.35, this.elapsed / 180);
  }

  private spawnWave(): void {
    const d = this.difficulty();
    const frenzy = this.frenzyTimer > 0;
    this.spawnTimer = frenzy ? rand(0.5, 0.8) : rand(1.5 - d * 0.9, 2.2 - d * 1.2);
    const speed = (0.75 + d * 0.9) * (frenzy ? 1.1 : 1);

    const roll = Math.random();
    let kind: BugKind = 'fly';
    if (!frenzy && this.rainbowCooldown <= 0 && roll < 0.08 && this.elapsed > 12) {
      kind = 'rainbow';
      this.rainbowCooldown = rand(22, 34);
    } else if (roll < 0.26) {
      kind = 'firefly';
    } else if (!frenzy && roll < 0.26 + 0.1 + d * 0.22 && this.elapsed > 6) {
      kind = 'wasp';
    }

    const pattern = pick(['sweep', 'sweep', 'wave', 'orbit', 'zig', 'dive'] as const);
    if (kind === 'rainbow') {
      this.bugs.push(this.makeBug('rainbow', 'orbit', speed * 0.9, 0));
      return;
    }
    if (kind === 'wasp') {
      // Wasps travel in a column of flies so the player must thread the snap.
      const count = 2 + Math.floor(d * 2);
      for (let i = 0; i < count; i++) {
        this.bugs.push(this.makeBug(i === Math.floor(count / 2) ? 'wasp' : 'fly', pattern, speed, i * 0.55));
      }
      if (d > 0.6 && Math.random() < 0.5) this.bugs.push(this.makeBug('wasp', pick(['sweep', 'zig'] as const), speed * 1.1, 0.2));
      return;
    }
    const count = kind === 'firefly' ? 1 + Math.floor(Math.random() * 2) : 2 + Math.floor(rand(0, 2 + d * 2));
    for (let i = 0; i < count; i++) {
      this.bugs.push(this.makeBug(kind, pattern, speed, i * 0.45));
    }
  }

  private makeBug(kind: BugKind, pattern: 'sweep' | 'wave' | 'orbit' | 'zig' | 'dive', speed: number, delay: number): Bug {
    const R = this.reach;
    const P = this.pepe;
    const w = this.w;
    const h = this.h;
    const margin = 60 * this.scale;
    const r = (kind === 'wasp' ? 15 : kind === 'firefly' ? 12 : kind === 'rainbow' ? 14 : 11) * this.scale;
    let path: (t: number) => Vec;
    let life: number;
    const base = (kind === 'wasp' ? 150 : 125) * this.scale * speed;

    if (pattern === 'orbit') {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const radius = rand(R * 0.4, R * 0.88);
      const a0 = rand(0, Math.PI * 2);
      const omega = (dir * base) / radius;
      const enter = 1.1;
      const stay = rand(3.5, 6);
      life = enter * 2 + stay + delay;
      path = (t) => {
        const tt = Math.max(0, t - delay);
        let rr: number;
        if (tt < enter) rr = radius + (1 - easeOutCubic(tt / enter)) * R * 1.4;
        else if (tt < enter + stay) rr = radius + Math.sin(tt * 2.1) * 10 * this.scale;
        else rr = radius + Math.pow((tt - enter - stay) / enter, 2) * R * 1.4;
        const a = a0 + omega * tt;
        return { x: P.x + Math.cos(a) * rr, y: P.y + Math.sin(a) * rr };
      };
    } else if (pattern === 'dive') {
      const fromLeft = Math.random() < 0.5;
      const sx = fromLeft ? -margin : w + margin;
      const ex = fromLeft ? w + margin : -margin;
      const sy = -margin;
      const depth = P.y + rand(-R * 0.3, R * 0.55);
      const dist = Math.hypot(ex - sx, depth - sy) * 1.4;
      const dur = dist / base;
      life = dur + delay;
      path = (t) => {
        const u = clamp((t - delay) / dur, 0, 1);
        const x = sx + (ex - sx) * u;
        const y = sy + (depth - sy) * Math.sin(u * Math.PI);
        return { x, y };
      };
    } else {
      // sweep / wave / zig: straight crossing with wobble, passing within reach.
      const horizontal = Math.random() < (h > w ? 0.6 : 0.75);
      const offset = rand(-R * 0.8, R * 0.8);
      let sx: number, sy: number, ex: number, ey: number;
      if (horizontal) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        sx = dir > 0 ? -margin : w + margin;
        ex = dir > 0 ? w + margin : -margin;
        sy = ey = clamp(P.y + offset, margin, h - margin);
      } else {
        const dir = Math.random() < 0.5 ? 1 : -1;
        sy = dir > 0 ? -margin : h + margin;
        ey = dir > 0 ? h + margin : -margin;
        sx = ex = clamp(P.x + offset, margin, w - margin);
      }
      const length = Math.hypot(ex - sx, ey - sy);
      const dur = length / base;
      const amp = pattern === 'sweep' ? rand(6, 16) * this.scale : pattern === 'wave' ? rand(30, 70) * this.scale : rand(28, 55) * this.scale;
      const freq = pattern === 'zig' ? rand(1.5, 2.5) : rand(0.7, 1.6);
      const phase = rand(0, Math.PI * 2);
      const nx = -(ey - sy) / length;
      const ny = (ex - sx) / length;
      life = dur + delay;
      path = (t) => {
        const tt = Math.max(0, t - delay);
        const u = clamp(tt / dur, 0, 1);
        let wob: number;
        if (pattern === 'zig') {
          const s = (tt * freq + phase) % 2;
          wob = (s < 1 ? s * 2 - 1 : 3 - s * 2) * amp;
        } else {
          wob = Math.sin(tt * freq * Math.PI + phase) * amp;
        }
        return { x: sx + (ex - sx) * u + nx * wob, y: sy + (ey - sy) * u + ny * wob };
      };
    }

    const p0 = path(0);
    return {
      kind,
      x: p0.x,
      y: p0.y,
      r,
      t: 0,
      life: life + 0.5,
      path,
      wing: rand(0, Math.PI * 2),
      hue: rand(0, 360),
      caught: false,
      nearMissed: false,
      dead: false,
      vx: 0,
      vy: 0,
    };
  }

  private updateBugs(dt: number, live: boolean): void {
    for (const b of this.bugs) {
      if (b.caught) continue;
      b.t += dt;
      b.wing += dt * (b.kind === 'wasp' ? 70 : 42);
      b.hue = (b.hue + dt * 240) % 360;
      const p = b.path(b.t);
      b.vx = (p.x - b.x) / Math.max(dt, 1e-4);
      b.vy = (p.y - b.y) / Math.max(dt, 1e-4);
      b.x = p.x;
      b.y = p.y;
      if (b.t > b.life) b.dead = true;
      if (live && b.kind === 'firefly' && Math.random() < dt * 6) {
        this.particles.push(this.spark(b.x, b.y, COLORS.gold, 0.3, 1.2, true));
      }
      if (live && b.kind === 'rainbow' && Math.random() < dt * 18) {
        this.particles.push(this.spark(b.x, b.y, `hsl(${b.hue} 90% 65%)`, 0.5, 1.6, true));
      }
    }
    this.bugs = this.bugs.filter((b) => !b.dead);
  }

  private tongueTip(): Vec {
    const mouth = this.mouthPos();
    return { x: mouth.x + Math.cos(this.tongue.angle) * this.tongue.len, y: mouth.y + Math.sin(this.tongue.angle) * this.tongue.len };
  }

  private mouthPos(): Vec {
    return { x: this.pepe.x, y: this.pepe.y + 10 * this.scale };
  }

  private updateTongue(dt: number): void {
    const tg = this.tongue;
    if (!tg.active) return;
    tg.t += dt;
    const total = TONGUE_OUT + TONGUE_HOLD + TONGUE_BACK;
    let extending = false;
    if (tg.t < TONGUE_OUT) {
      tg.len = easeOutBack(tg.t / TONGUE_OUT) * this.reach;
      extending = true;
    } else if (tg.t < TONGUE_OUT + TONGUE_HOLD) {
      tg.len = this.reach;
      extending = true;
    } else if (tg.t < total) {
      tg.len = (1 - easeOutCubic((tg.t - TONGUE_OUT - TONGUE_HOLD) / TONGUE_BACK)) * this.reach;
    } else {
      tg.len = 0;
    }

    const mouth = this.mouthPos();
    const tip = this.tongueTip();
    const tongueR = 7 * this.scale;

    if (extending && !tg.hitWasp) {
      for (const b of this.bugs) {
        if (b.caught || b.dead) continue;
        const dist = segmentDistance(b.x, b.y, mouth.x, mouth.y, tip.x, tip.y);
        if (dist < b.r + tongueR) {
          if (b.kind === 'wasp') {
            this.hitWasp(b);
            break;
          }
          b.caught = true;
          b.x = tip.x;
          b.y = tip.y;
          this.catchBug(b);
        } else if (b.kind === 'wasp' && !b.nearMissed && dist < b.r + tongueR + 30 * this.scale) {
          b.nearMissed = true;
          tg.nearMisses++;
        }
      }
    }

    // Caught bugs ride the tongue back.
    for (const b of this.bugs) {
      if (b.caught) {
        b.x = tip.x;
        b.y = tip.y;
      }
    }

    if (tg.t >= total) {
      tg.active = false;
      tg.len = 0;
      this.bugs = this.bugs.filter((b) => !b.caught);
      if (!tg.hitWasp) {
        if (tg.nearMisses > 0) {
          const bonus = 40 * tg.nearMisses * this.multiplier * (this.frenzyTimer > 0 ? FRENZY_SCORE_MULT : 1);
          this.addScore(bonus);
          this.audio.play('nearMiss');
          this.text(mouth.x, mouth.y - 90 * this.scale, `Close call! +${bonus}`, COLORS.cream, 22);
        }
        if (tg.catches === 0) {
          this.streak = 0;
          this.audio.play('miss');
        } else {
          this.streak++;
          if (this.streak % 4 === 0) this.raiseMultiplier('Streak');
          if (tg.catches >= 2) {
            const label = tg.catches === 2 ? 'Double!' : tg.catches === 3 ? 'Triple!' : `${tg.catches}x chain!`;
            const bonus = 25 * (tg.catches - 1) * this.multiplier;
            this.addScore(bonus);
            this.text(mouth.x, mouth.y - 70 * this.scale, `${label} +${bonus}`, COLORS.mintLight, 24);
          }
        }
      }
      this.snapCooldown = 0.04;
    }
  }

  private catchBug(b: Bug): void {
    const tg = this.tongue;
    tg.catches++;
    this.caught++;
    this.idleTimer = 0;
    const frenzyMult = this.frenzyTimer > 0 ? FRENZY_SCORE_MULT : 1;
    const points = POINTS[b.kind] * this.multiplier * frenzyMult;
    this.addScore(points);
    const color = b.kind === 'firefly' ? COLORS.gold : b.kind === 'rainbow' ? `hsl(${b.hue} 90% 70%)` : COLORS.fly;
    this.burst(b.x, b.y, color, b.kind === 'fly' ? 10 : 20, b.kind !== 'fly');
    this.text(b.x, b.y - 18 * this.scale, `+${points}`, color, b.kind === 'fly' ? 18 : 22);
    this.audio.play('catch', Math.min(this.streak + tg.catches, 7));

    if (b.kind === 'firefly') {
      this.audio.play('gold');
      this.raiseMultiplier('Firefly');
      this.flashScreen(COLORS.gold, 0.18);
    } else if (b.kind === 'rainbow') {
      this.startFrenzy();
    }
  }

  private raiseMultiplier(reason: string): void {
    if (this.multiplier >= MAX_MULTIPLIER) {
      this.text(this.pepe.x, this.pepe.y - 120 * this.scale, 'MAX 12x', COLORS.tongue, 26);
      return;
    }
    this.multiplier++;
    this.bestMultiplier = Math.max(this.bestMultiplier, this.multiplier);
    this.audio.play('multiUp', this.multiplier);
    const atMax = this.multiplier === MAX_MULTIPLIER;
    this.text(
      this.pepe.x,
      this.pepe.y - 120 * this.scale,
      atMax ? 'MAX 12x!' : `${reason} ${this.multiplier}x`,
      atMax ? COLORS.tongue : COLORS.gold,
      atMax ? 30 : 24,
    );
    if (atMax) {
      this.flashScreen(COLORS.tongue, 0.22);
      this.events.onAnnounce('Maximum multiplier, 12x');
    }
    this.events.onScore(this.score, this.multiplier);
  }

  private startFrenzy(): void {
    this.frenzyTimer = FRENZY_DURATION;
    this.audio.setFrenzy(true);
    this.audio.play('rainbow');
    this.flashScreen('#ffffff', 0.5);
    this.shakeScreen(10);
    this.text(this.pepe.x, this.pepe.y - 150 * this.scale, 'FRENZY!', '#ffffff', 40);
    this.events.onFrenzy(true, 1);
    this.events.onAnnounce('Frenzy mode: slow motion, triple score');
    if (!this.reducedMotion) {
      for (let i = 0; i < 40; i++) {
        this.particles.push(this.spark(this.pepe.x, this.pepe.y, `hsl(${rand(0, 360)} 90% 65%)`, 1.2, rand(120, 420) * this.scale, true));
      }
    }
  }

  private hitWasp(b: Bug): void {
    const tg = this.tongue;
    tg.hitWasp = true;
    tg.t = Math.max(tg.t, TONGUE_OUT + TONGUE_HOLD);
    b.dead = true;
    this.lives--;
    this.multiplier = 1;
    this.streak = 0;
    this.idleTimer = 0;
    this.hurtTimer = 1.1;
    this.snapCooldown = 0.5;
    this.audio.play('wasp');
    this.shakeScreen(18);
    this.flashScreen(COLORS.danger, 0.35);
    this.burst(b.x, b.y, COLORS.waspDark, 16, false);
    this.burst(b.x, b.y, COLORS.wasp, 10, false);
    this.text(b.x, b.y - 20 * this.scale, 'Ouch!', COLORS.danger, 28);
    this.events.onLives(this.lives);
    this.events.onScore(this.score, this.multiplier);
    this.events.onAnnounce(this.lives > 0 ? `Wasp hit. ${this.lives} ${this.lives === 1 ? 'life' : 'lives'} left, multiplier reset` : 'Wasp hit. Run over');
    if (this.lives <= 0) {
      this.phase = 'over';
      this.frenzyTimer = 0;
      this.audio.setFrenzy(false);
      this.audio.play('gameOver');
      this.events.onFrenzy(false, 0);
      this.events.onGameOver({ score: this.score, bestMultiplier: this.bestMultiplier, caught: this.caught, elapsed: this.elapsed });
    }
  }

  private addScore(points: number): void {
    this.score += Math.round(points);
    this.events.onScore(this.score, this.multiplier);
  }

  /* ---------- cosmetics ---------- */

  private updateCosmetics(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 40);
    this.flash.alpha = Math.max(0, this.flash.alpha - dt * 2.2);
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= 1 - dt * 1.5;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= dt * 34 * this.scale;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const r of this.ripples) {
      r.r += r.speed * dt * this.scale;
      r.life = 1 - r.r / r.max;
    }
    this.ripples = this.ripples.filter((r) => r.life > 0);
  }

  private updateAttract(dt: number): void {
    // Idle pond behind the start screen: a few harmless flies drift by.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.bugs.length < 4) {
      this.spawnTimer = rand(1.5, 3);
      this.bugs.push(this.makeBug(Math.random() < 0.3 ? 'firefly' : 'fly', 'wave', 0.6, 0));
    }
    this.updateBugs(dt, true);
  }

  private updateScenery(dt: number): void {
    for (const f of this.ambient) {
      f.p += dt * f.s;
      f.x += Math.sin(f.p) * 8 * dt;
      f.y += Math.cos(f.p * 0.7) * 6 * dt;
    }
  }

  private seedScenery(): void {
    const seeded = (n: number) => {
      // Deterministic pseudo-random so scenery does not reshuffle on resize.
      const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    this.stars = [];
    for (let i = 0; i < 70; i++) {
      this.stars.push({ x: seeded(i) * this.w, y: seeded(i + 100) * this.h * 0.45, r: 0.6 + seeded(i + 200) * 1.4, p: seeded(i + 300) * 6.28 });
    }
    this.ambient = [];
    for (let i = 0; i < 14; i++) {
      this.ambient.push({ x: seeded(i + 400) * this.w, y: this.h * 0.3 + seeded(i + 500) * this.h * 0.65, p: seeded(i + 600) * 6.28, s: 0.6 + seeded(i + 700) });
    }
    this.pads = [];
    for (let i = 0; i < 7; i++) {
      const x = seeded(i + 800) * this.w;
      const y = this.h * 0.45 + seeded(i + 900) * this.h * 0.55;
      if (Math.hypot(x - this.pepe.x, y - this.pepe.y) < 120 * this.scale) continue;
      this.pads.push({ x, y, r: (26 + seeded(i + 1000) * 26) * this.scale, rot: seeded(i + 1100) * 6.28, p: seeded(i + 1200) * 6.28 });
    }
  }

  private spark(x: number, y: number, color: string, life: number, speed: number, glow: boolean): Particle {
    const a = rand(0, Math.PI * 2);
    const v = rand(0.3, 1) * speed;
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: rand(1.5, 3.5) * this.scale, color, glow, gravity: 0 };
  }

  private burst(x: number, y: number, color: string, count: number, glow: boolean): void {
    const n = this.reducedMotion ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n; i++) {
      const p = this.spark(x, y, color, rand(0.4, 0.9), rand(80, 260) * this.scale, glow);
      p.gravity = 160 * this.scale;
      this.particles.push(p);
    }
  }

  private text(x: number, y: number, text: string, color: string, size: number): void {
    this.texts.push({ x, y, text, color, life: 1.1, max: 1.1, size: size * this.scale });
  }

  private flashScreen(color: string, alpha: number): void {
    this.flash = { color, alpha: this.reducedMotion ? alpha * 0.4 : alpha };
  }

  private shakeScreen(amount: number): void {
    if (this.reducedMotion) return;
    this.shake = Math.max(this.shake, amount * this.scale);
  }

  /* ---------- rendering ---------- */

  render(): void {
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.save();
    if (this.shake > 0) {
      ctx.translate(rand(-this.shake, this.shake) * 0.5, rand(-this.shake, this.shake) * 0.5);
    }
    this.drawSky();
    this.drawWater();
    this.drawPads();
    this.drawAmbient();
    this.drawAim();
    this.drawTongue();
    this.drawPepe();
    this.drawBugs();
    this.drawParticles();
    this.drawTexts();
    ctx.restore();

    if (this.frenzyTimer > 0) {
      const hue = (this.time * 120) % 360;
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `hsl(${hue} 90% 60% / 0.45)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } else {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.max(w, h) * 0.8);
      g.addColorStop(0, 'rgba(3,8,24,0)');
      g.addColorStop(1, 'rgba(3,8,24,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.flash.alpha > 0) {
      ctx.globalAlpha = this.flash.alpha;
      ctx.fillStyle = this.flash.color;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  private drawSky(): void {
    const ctx = this.ctx;
    const { w, h } = this;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#070f2a');
    sky.addColorStop(0.45, '#0e2150');
    sky.addColorStop(1, '#15397a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Stars
    for (const s of this.stars) {
      const tw = 0.55 + 0.45 * Math.sin(this.time * 1.4 + s.p);
      ctx.globalAlpha = tw;
      ctx.fillStyle = COLORS.cream;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Moon with halo
    const mx = w * 0.8;
    const my = h * 0.14;
    const mr = 34 * this.scale;
    const halo = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 5);
    halo.addColorStop(0, 'rgba(246,237,200,0.35)');
    halo.addColorStop(1, 'rgba(246,237,200,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
    ctx.fillStyle = COLORS.cream;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(190,180,150,0.35)';
    ctx.beginPath();
    ctx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.22, 0, Math.PI * 2);
    ctx.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.16, 0, Math.PI * 2);
    ctx.fill();

    // Distant reeds silhouettes along the water line
    const horizon = h * 0.36;
    ctx.fillStyle = '#081432';
    ctx.beginPath();
    ctx.moveTo(0, horizon + 10);
    for (let x = 0; x <= w; x += 14) {
      const n = Math.sin(x * 0.045) * 7 + Math.sin(x * 0.013 + 2) * 12;
      ctx.lineTo(x, horizon - 4 + n);
    }
    ctx.lineTo(w, horizon + 40);
    ctx.lineTo(0, horizon + 40);
    ctx.closePath();
    ctx.fill();
    // Reed clumps near both banks, curved and uneven so they read as plants.
    ctx.strokeStyle = '#06102a';
    ctx.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      const side = i % 2 === 0 ? 0 : 1;
      const spread = Math.abs(Math.sin(i * 2.7));
      const x = side === 0 ? w * 0.02 + spread * w * 0.2 : w * 0.78 + spread * w * 0.2;
      const hgt = (18 + Math.abs(Math.sin(i * 3.1)) * 54) * this.scale;
      const lean = (Math.sin(i * 1.9) * 18 + (side === 0 ? 8 : -8)) * this.scale;
      const sway = Math.sin(this.time * 0.7 + i) * 3;
      ctx.lineWidth = (1.5 + Math.abs(Math.sin(i * 4.3)) * 1.8) * this.scale;
      ctx.beginPath();
      ctx.moveTo(x, horizon + 8);
      ctx.quadraticCurveTo(x + lean * 0.3 + sway, horizon - hgt * 0.55, x + lean + sway * 2, horizon - hgt);
      ctx.stroke();
      if (i % 3 === 0) {
        ctx.fillStyle = '#06102a';
        ctx.beginPath();
        ctx.ellipse(x + lean + sway * 2, horizon - hgt - 4 * this.scale, 2.2 * this.scale, 7 * this.scale, lean * 0.01, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawWater(): void {
    const ctx = this.ctx;
    const { w, h } = this;
    const horizon = h * 0.36;
    const water = ctx.createLinearGradient(0, horizon, 0, h);
    water.addColorStop(0, '#0f2a5e');
    water.addColorStop(1, '#17407f');
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, w, h - horizon);

    // Moon reflection
    const mx = w * 0.8;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = COLORS.cream;
    for (let i = 0; i < 9; i++) {
      const y = horizon + 14 + Math.pow(i / 8, 1.35) * (h - horizon) * 0.5 + Math.sin(i * 2.3) * 6;
      const wobble = Math.sin(this.time * 1.4 + i * 1.7) * (12 + i * 2);
      const width = (54 - i * 5 + Math.sin(i * 5.1) * 8) * this.scale;
      ctx.globalAlpha = 0.07 + 0.14 * (1 - i / 9) + 0.04 * Math.sin(this.time * 2 + i);
      ctx.beginPath();
      ctx.ellipse(mx + wobble, y, Math.max(6, width), 1.6 + (i % 2) * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Shimmer lines
    ctx.strokeStyle = 'rgba(169,240,198,0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      const y = horizon + 30 + i * (h - horizon) * 0.06;
      const off = Math.sin(this.time * 0.9 + i) * 24;
      ctx.beginPath();
      ctx.moveTo(w * 0.1 + off, y);
      ctx.lineTo(w * 0.1 + off + rand(0, 0) + 60 * this.scale + (i % 3) * 30, y);
      ctx.stroke();
    }

    // Ripples
    for (const r of this.ripples) {
      ctx.globalAlpha = r.life * 0.35;
      ctx.strokeStyle = COLORS.mintLight;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawPad(x: number, y: number, r: number, rot: number, bob: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.scale(1, 0.55);
    ctx.rotate(rot);
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#4fbf85');
    g.addColorStop(1, '#2a8a5b');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, 0.35, Math.PI * 2 - 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(169,240,198,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private drawPads(): void {
    for (const p of this.pads) {
      this.drawPad(p.x, p.y, p.r, p.rot, Math.sin(this.time * 1.1 + p.p) * 2);
    }
    // Pepe's pad
    this.drawPad(this.pepe.x, this.pepe.y + 44 * this.scale, 78 * this.scale, 0.2, Math.sin(this.time * 1.3) * 2);
  }

  private drawAmbient(): void {
    const ctx = this.ctx;
    for (const f of this.ambient) {
      const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(f.p * 2));
      ctx.globalAlpha = a;
      ctx.fillStyle = COLORS.gold;
      ctx.shadowColor = COLORS.gold;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 1.6 * this.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  private drawAim(): void {
    if (this.phase !== 'playing') return;
    const ctx = this.ctx;
    const m = this.mouthPos();
    const a = this.aim;
    ctx.save();
    ctx.setLineDash([4 * this.scale, 10 * this.scale]);
    ctx.lineDashOffset = -this.time * 40;
    ctx.strokeStyle = 'rgba(251,246,230,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.x + Math.cos(a) * 40 * this.scale, m.y + Math.sin(a) * 40 * this.scale);
    ctx.lineTo(m.x + Math.cos(a) * this.reach, m.y + Math.sin(a) * this.reach);
    ctx.stroke();
    ctx.setLineDash([]);
    // Reach ring (very faint) so range is readable.
    ctx.strokeStyle = 'rgba(169,240,198,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(m.x, m.y, this.reach, 0, Math.PI * 2);
    ctx.stroke();
    // Reticle at reach.
    const rx = m.x + Math.cos(a) * this.reach;
    const ry = m.y + Math.sin(a) * this.reach;
    ctx.strokeStyle = this.showReticle ? 'rgba(251,246,230,0.8)' : 'rgba(251,246,230,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rx, ry, 9 * this.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawTongue(): void {
    const tg = this.tongue;
    if (!tg.active || tg.len <= 0) return;
    const ctx = this.ctx;
    const m = this.mouthPos();
    const tip = this.tongueTip();
    const sag = Math.sin(tg.t * 30) * 6 * this.scale;
    const nx = -Math.sin(tg.angle);
    const ny = Math.cos(tg.angle);
    const cx = (m.x + tip.x) / 2 + nx * sag;
    const cy = (m.y + tip.y) / 2 + ny * sag;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLORS.tongueDark;
    ctx.lineWidth = 12 * this.scale;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.quadraticCurveTo(cx, cy, tip.x, tip.y);
    ctx.stroke();
    ctx.strokeStyle = COLORS.tongue;
    ctx.lineWidth = 8 * this.scale;
    ctx.stroke();
    ctx.fillStyle = COLORS.tongue;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 10 * this.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(tip.x - 3 * this.scale, tip.y - 3 * this.scale, 3.5 * this.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawPepe(): void {
    const ctx = this.ctx;
    const s = this.scale;
    const P = this.pepe;
    const bob = Math.sin(this.time * 1.3) * 2;
    const hurt = this.hurtTimer > 0;
    const snapping = this.tongue.active;
    const lean = Math.cos(this.aim) * 0.08;
    const stretch = snapping ? 1 + 0.08 * Math.sin((this.tongue.t / (TONGUE_OUT + TONGUE_HOLD + TONGUE_BACK)) * Math.PI) : 1;

    ctx.save();
    ctx.translate(P.x, P.y + bob);
    ctx.rotate(lean);
    ctx.scale(2 - stretch, stretch);

    // Shadow on pad
    ctx.fillStyle = 'rgba(6,14,34,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 40 * s, 44 * s, 10 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Back legs
    ctx.fillStyle = COLORS.mintDark;
    ctx.beginPath();
    ctx.ellipse(-40 * s, 26 * s, 18 * s, 11 * s, -0.4, 0, Math.PI * 2);
    ctx.ellipse(40 * s, 26 * s, 18 * s, 11 * s, 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Body
    const body = ctx.createRadialGradient(-12 * s, -20 * s, 8 * s, 0, 0, 60 * s);
    body.addColorStop(0, hurt ? '#b8e6c9' : COLORS.mintLight);
    body.addColorStop(0.55, COLORS.mint);
    body.addColorStop(1, COLORS.mintDark);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 4 * s, 46 * s, 36 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Belly
    ctx.fillStyle = 'rgba(251,246,230,0.55)';
    ctx.beginPath();
    ctx.ellipse(0, 16 * s, 26 * s, 16 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Front hands on the pad
    ctx.fillStyle = COLORS.mint;
    ctx.beginPath();
    ctx.ellipse(-24 * s, 36 * s, 11 * s, 6 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(24 * s, 36 * s, 11 * s, 6 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    const look = { x: Math.cos(this.aim) * 3 * s, y: Math.sin(this.aim) * 2.5 * s };
    for (const ex of [-20, 20]) {
      ctx.fillStyle = COLORS.mint;
      ctx.beginPath();
      ctx.arc(ex * s, -26 * s, 15 * s, 0, Math.PI * 2);
      ctx.fill();
      if (hurt) {
        ctx.strokeStyle = COLORS.navy;
        ctx.lineWidth = 3 * s;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo((ex - 6) * s, -31 * s);
        ctx.lineTo((ex + 6) * s, -21 * s);
        ctx.moveTo((ex + 6) * s, -31 * s);
        ctx.lineTo((ex - 6) * s, -21 * s);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ex * s, -26 * s, 10.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS.navy;
        ctx.beginPath();
        ctx.arc(ex * s + look.x, -26 * s + look.y, 5.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ex * s + look.x - 2 * s, -28 * s + look.y, 2 * s, 0, Math.PI * 2);
        ctx.fill();
        // Eyelid: a calm, slightly heavy lid gives the pond mood.
        ctx.fillStyle = COLORS.mint;
        ctx.beginPath();
        ctx.ellipse(ex * s, -34 * s, 15 * s, 6 * s, 0, Math.PI, Math.PI * 2);
        ctx.fill();
      }
    }

    // Mouth
    ctx.strokeStyle = COLORS.navy;
    ctx.lineWidth = 3 * s;
    ctx.lineCap = 'round';
    if (snapping) {
      ctx.fillStyle = '#4a1230';
      ctx.beginPath();
      ctx.ellipse(0, 10 * s, 14 * s, 9 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (hurt) {
      ctx.beginPath();
      ctx.moveTo(-16 * s, 14 * s);
      ctx.quadraticCurveTo(0, 4 * s, 16 * s, 14 * s);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(-24 * s, 6 * s);
      ctx.quadraticCurveTo(0, 20 * s, 24 * s, 6 * s);
      ctx.stroke();
    }
    // Nostrils
    ctx.fillStyle = COLORS.navy;
    ctx.beginPath();
    ctx.arc(-6 * s, -4 * s, 1.6 * s, 0, Math.PI * 2);
    ctx.arc(6 * s, -4 * s, 1.6 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawBugs(): void {
    const ctx = this.ctx;
    const s = this.scale;
    for (const b of this.bugs) {
      ctx.save();
      ctx.translate(b.x, b.y);
      const facing = b.vx < 0 ? -1 : 1;
      const flap = Math.sin(b.wing);
      switch (b.kind) {
        case 'fly': {
          ctx.scale(facing, 1);
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.beginPath();
          ctx.ellipse(-2 * s, -8 * s, 9 * s, 4 * s, -0.5 + flap * 0.5, 0, Math.PI * 2);
          ctx.ellipse(-2 * s, 8 * s, 9 * s, 4 * s, 0.5 - flap * 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = COLORS.fly;
          ctx.beginPath();
          ctx.ellipse(0, 0, b.r, b.r * 0.62, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#7a8bc4';
          ctx.beginPath();
          ctx.arc(b.r * 0.7, 0, b.r * 0.42, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ff6f9c';
          ctx.beginPath();
          ctx.arc(b.r * 0.9, -b.r * 0.2, b.r * 0.16, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'firefly': {
          const pulse = 0.7 + 0.3 * Math.sin(this.time * 6 + b.hue);
          const g = ctx.createRadialGradient(0, 0, 2 * s, 0, 0, b.r * 2.6);
          g.addColorStop(0, `rgba(255,209,102,${0.9 * pulse})`);
          g.addColorStop(1, 'rgba(255,209,102,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, b.r * 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.scale(facing, 1);
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.beginPath();
          ctx.ellipse(-2 * s, -7 * s, 8 * s, 3.5 * s, -0.5 + flap * 0.4, 0, Math.PI * 2);
          ctx.ellipse(-2 * s, 7 * s, 8 * s, 3.5 * s, 0.5 - flap * 0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = COLORS.gold;
          ctx.beginPath();
          ctx.ellipse(0, 0, b.r, b.r * 0.6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff4c2';
          ctx.beginPath();
          ctx.ellipse(-b.r * 0.4, 0, b.r * 0.5, b.r * 0.4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#5a3a12';
          ctx.beginPath();
          ctx.arc(b.r * 0.75, 0, b.r * 0.36, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'rainbow': {
          const g = ctx.createRadialGradient(0, 0, 2 * s, 0, 0, b.r * 3);
          g.addColorStop(0, `hsl(${b.hue} 95% 70% / 0.8)`);
          g.addColorStop(1, `hsl(${(b.hue + 60) % 360} 95% 60% / 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, b.r * 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.scale(facing, 1);
          ctx.fillStyle = `hsl(${(b.hue + 180) % 360} 90% 80% / 0.5)`;
          ctx.beginPath();
          ctx.ellipse(-2 * s, -9 * s, 10 * s, 4.5 * s, -0.5 + flap * 0.5, 0, Math.PI * 2);
          ctx.ellipse(-2 * s, 9 * s, 10 * s, 4.5 * s, 0.5 - flap * 0.5, 0, Math.PI * 2);
          ctx.fill();
          const body = ctx.createLinearGradient(-b.r, 0, b.r, 0);
          body.addColorStop(0, `hsl(${b.hue} 90% 60%)`);
          body.addColorStop(0.5, `hsl(${(b.hue + 90) % 360} 90% 60%)`);
          body.addColorStop(1, `hsl(${(b.hue + 180) % 360} 90% 60%)`);
          ctx.fillStyle = body;
          ctx.beginPath();
          ctx.ellipse(0, 0, b.r, b.r * 0.66, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(b.r * 0.6, -b.r * 0.15, b.r * 0.22, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'wasp': {
          // Danger halo so the silhouette reads instantly, plus angular wings.
          ctx.fillStyle = 'rgba(255,92,92,0.14)';
          ctx.beginPath();
          ctx.arc(0, 0, b.r * 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.scale(facing, 1);
          ctx.fillStyle = 'rgba(220,230,255,0.45)';
          ctx.beginPath();
          ctx.moveTo(-2 * s, -3 * s);
          ctx.lineTo(-16 * s, -14 * s - flap * 4 * s);
          ctx.lineTo(4 * s, -8 * s);
          ctx.closePath();
          ctx.moveTo(-2 * s, 3 * s);
          ctx.lineTo(-16 * s, 14 * s + flap * 4 * s);
          ctx.lineTo(4 * s, 8 * s);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = COLORS.wasp;
          ctx.beginPath();
          ctx.ellipse(-2 * s, 0, b.r, b.r * 0.6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(-2 * s, 0, b.r, b.r * 0.6, 0, 0, Math.PI * 2);
          ctx.clip();
          ctx.fillStyle = COLORS.waspDark;
          for (let i = -1; i <= 1; i++) {
            ctx.fillRect(-2 * s + i * 7 * s - 2 * s, -b.r, 3.5 * s, b.r * 2);
          }
          ctx.restore();
          ctx.fillStyle = COLORS.waspDark;
          ctx.beginPath();
          ctx.arc(b.r * 0.75, 0, b.r * 0.42, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-b.r * 0.95, 0);
          ctx.lineTo(-b.r * 1.5, 0);
          ctx.lineTo(-b.r * 0.9, 3 * s);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = COLORS.danger;
          ctx.beginPath();
          ctx.arc(b.r * 0.9, -b.r * 0.18, b.r * 0.14, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
      ctx.restore();
    }
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.glow) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  private drawTexts(): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const u = 1 - t.life / t.max;
      const pop = this.reducedMotion ? 1 : u < 0.15 ? easeOutBack(u / 0.15) : 1;
      ctx.globalAlpha = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
      ctx.font = `800 ${t.size * pop}px ${FONT_DISPLAY}`;
      ctx.lineWidth = 5 * this.scale;
      ctx.strokeStyle = 'rgba(6,14,34,0.85)';
      ctx.lineJoin = 'round';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  /** Test hook (used by the verification script only): place a bug at a world point. */
  debugSpawnAt(kind: BugKind, x: number, y: number): void {
    const b = this.makeBug(kind, 'sweep', 0.001, 0);
    b.path = () => ({ x, y });
    b.x = x;
    b.y = y;
    b.life = 60;
    this.bugs.push(b);
  }

  get pepePosition(): Vec {
    return { x: this.pepe.x, y: this.pepe.y };
  }

  get bugCount(): number {
    return this.bugs.length;
  }

  get frenzyActive(): boolean {
    return this.frenzyTimer > 0;
  }

  /** Expose a sound trigger for the shell (UI clicks). */
  sfx(name: Sfx): void {
    this.audio.play(name);
  }
}
