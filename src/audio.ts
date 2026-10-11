/**
 * All sound is synthesized with the Web Audio API, so no audio files ship and
 * nothing needs to load. The context is created lazily on the first user gesture
 * (browsers block autoplay) and resumed on every gesture afterwards.
 */
export type Sfx =
  | 'snap'
  | 'catch'
  | 'gold'
  | 'rainbow'
  | 'frenzyEnd'
  | 'wasp'
  | 'nearMiss'
  | 'multiUp'
  | 'miss'
  | 'ui'
  | 'gameOver';

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16]; // major pentatonic steps
const ROOT = 220; // A3

function midiRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private musicTimer = 0;
  private nextBeat = 0;
  private beatIndex = 0;
  private running = false;
  private frenzy = false;

  get state(): string {
    return this.ctx ? this.ctx.state : 'none';
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = 0.5;
        this.sfxBus.connect(this.master);
        this.musicFilter = this.ctx.createBiquadFilter();
        this.musicFilter.type = 'lowpass';
        this.musicFilter.frequency.value = 2400;
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = 0.22;
        this.musicBus.connect(this.musicFilter).connect(this.master);
        this.noiseBuffer = this.makeNoise();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
  }

  setFrenzy(on: boolean): void {
    this.frenzy = on;
    if (this.musicFilter && this.ctx) {
      this.musicFilter.frequency.setTargetAtTime(on ? 900 : 2400, this.ctx.currentTime, 0.2);
    }
  }

  /** Duck music while paused without tearing the scheduler down. */
  setPaused(paused: boolean): void {
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(paused ? 0.06 : 0.22, this.ctx.currentTime, 0.05);
    }
  }

  startMusic(): void {
    if (!this.ctx || this.running) return;
    this.running = true;
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.beatIndex = 0;
    this.scheduleMusic();
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 200);
  }

  stopMusic(): void {
    this.running = false;
    window.clearInterval(this.musicTimer);
  }

  play(name: Sfx, detail = 0): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || this.muted) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'snap': {
        this.noise(t, 0.09, 1800, 0.5);
        this.tone(t, 'triangle', 520, 180, 0.08, 0.35);
        break;
      }
      case 'catch': {
        const step = Math.min(detail, 7);
        const f = ROOT * 2 * midiRatio(PENTATONIC[step] ?? 0);
        this.tone(t, 'sine', f, f * 1.5, 0.12, 0.5, true);
        this.tone(t, 'triangle', f * 2, f * 2, 0.06, 0.15);
        break;
      }
      case 'gold': {
        [0, 4, 7, 12].forEach((s, i) => {
          this.tone(t + i * 0.06, 'sine', 880 * midiRatio(s), 880 * midiRatio(s), 0.22, 0.4);
        });
        this.tone(t, 'triangle', 1760, 2400, 0.3, 0.12);
        break;
      }
      case 'rainbow': {
        this.tone(t, 'sawtooth', 220, 1320, 0.6, 0.18);
        [0, 2, 4, 7, 9, 12, 14, 16].forEach((s, i) => {
          this.tone(t + i * 0.05, 'sine', 660 * midiRatio(s), 660 * midiRatio(s), 0.3, 0.3);
        });
        break;
      }
      case 'frenzyEnd': {
        this.tone(t, 'triangle', 1200, 300, 0.5, 0.25);
        break;
      }
      case 'wasp': {
        this.tone(t, 'sawtooth', 180, 60, 0.35, 0.5);
        this.tone(t, 'square', 90, 40, 0.3, 0.3);
        this.noise(t, 0.25, 600, 0.6);
        break;
      }
      case 'nearMiss': {
        this.noise(t, 0.22, 3600, 0.35, 900);
        this.tone(t + 0.05, 'sine', 1400, 2000, 0.15, 0.2);
        break;
      }
      case 'multiUp': {
        const f = 660 * midiRatio(Math.min(detail, 12));
        this.tone(t, 'sine', f, f, 0.18, 0.4);
        this.tone(t + 0.07, 'sine', f * 1.5, f * 1.5, 0.22, 0.3);
        break;
      }
      case 'miss': {
        this.tone(t, 'triangle', 300, 200, 0.1, 0.12);
        break;
      }
      case 'ui': {
        this.tone(t, 'sine', 740, 740, 0.08, 0.25);
        break;
      }
      case 'gameOver': {
        [0, -3, -7, -12].forEach((s, i) => {
          this.tone(t + i * 0.18, 'triangle', 440 * midiRatio(s), 440 * midiRatio(s), 0.35, 0.35);
        });
        break;
      }
    }
  }

  private tone(
    at: number,
    type: OscillatorType,
    fromHz: number,
    toHz: number,
    duration: number,
    volume: number,
    pluck = false,
  ): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + (pluck ? 0.005 : 0.015));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(bus);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private noise(at: number, duration: number, cutoff: number, volume: number, highpass = 0): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || !this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff, at);
    lp.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.2), at + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    let node: AudioNode = src;
    node = node.connect(lp);
    if (highpass > 0) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = highpass;
      node = node.connect(hp);
    }
    node.connect(gain).connect(bus);
    src.start(at);
    src.stop(at + duration + 0.02);
  }

  private makeNoise(): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const length = Math.floor(ctx.sampleRate * 0.6);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /* ---------- generative chill pond loop ---------- */

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    const beat = 0.5; // 120 bpm eighth-notes feel; chords every 8 beats
    while (this.nextBeat < ctx.currentTime + 0.6) {
      this.musicBeat(this.nextBeat, this.beatIndex);
      this.nextBeat += beat;
      this.beatIndex++;
    }
  }

  private musicBeat(at: number, index: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    const chords = [
      [0, 4, 7, 11], // Amaj7
      [5, 9, 12, 16], // Dmaj7 (relative)
      [2, 5, 9, 12], // Bm7
      [7, 11, 14, 17], // E
    ];
    const bar = Math.floor(index / 8) % chords.length;
    const chord = chords[bar] ?? chords[0]!;
    const inBar = index % 8;

    // Soft pad on chord change.
    if (inBar === 0) {
      chord.forEach((s, i) => {
        this.padNote(at, ROOT * midiRatio(s - 12), 4.2, 0.07 - i * 0.01);
      });
    }
    // Gentle arpeggio pluck, skipping some beats for breathing room.
    const pattern = this.frenzy ? [1, 1, 1, 1, 1, 1, 1, 1] : [1, 0, 1, 1, 0, 1, 0, 1];
    if (pattern[inBar]) {
      const noteIdx = (index * 3 + bar) % chord.length;
      const semis = (chord[noteIdx] ?? 0) + (index % 16 >= 8 ? 12 : 0);
      this.pluck(at + 0.02, ROOT * 2 * midiRatio(semis), 0.09);
    }
    // Occasional cricket chirp high in the mix.
    if (index % 4 === 3 && Math.random() < 0.35) {
      this.pluck(at + Math.random() * 0.3, 4200 + Math.random() * 600, 0.012, 'triangle');
    }
    // Low water heartbeat.
    if (inBar === 0 || inBar === 4) {
      this.padNote(at, ROOT / 4 * midiRatio(chord[0] ?? 0), 1.2, 0.09, 'sine');
    }
  }

  private padNote(at: number, hz: number, duration: number, volume: number, type: OscillatorType = 'triangle'): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc2.type = 'sine';
    osc.frequency.value = hz;
    osc2.frequency.value = hz * 1.005;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.6);
    gain.gain.setValueAtTime(volume, at + duration - 1.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(bus);
    osc.start(at);
    osc2.start(at);
    osc.stop(at + duration + 0.05);
    osc2.stop(at + duration + 0.05);
  }

  private pluck(at: number, hz: number, volume: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
    osc.connect(gain).connect(bus);
    osc.start(at);
    osc.stop(at + 1);
  }
}
