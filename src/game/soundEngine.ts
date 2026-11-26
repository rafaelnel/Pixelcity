/**
 * Subtle 8-bit procedural Web Audio synthesizer for Pixópolis.
 * Safe in headless browsers and lazy-unlocks on user gesture.
 */
class RetroSoundEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (!this.muted) {
      this.playSelect();
    }
    return this.muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    duration: number,
    type: OscillatorType = 'square',
    volume: number = 0.055,
    delay: number = 0,
    endFreq?: number
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playSelect(): void {
    this.playTone(520, 0.055, 'square', 0.035, 0, 620);
  }

  public playInvestUp(): void {
    this.playTone(440, 0.06, 'square', 0.045, 0);
    this.playTone(660, 0.09, 'square', 0.045, 0.055);
  }

  public playInvestDown(): void {
    this.playTone(440, 0.055, 'triangle', 0.05, 0);
    this.playTone(310, 0.08, 'triangle', 0.045, 0.05);
  }

  public playLevel3(): void {
    this.playTone(523.25, 0.07, 'square', 0.04, 0);
    this.playTone(659.25, 0.07, 'square', 0.04, 0.065);
    this.playTone(783.99, 0.07, 'square', 0.04, 0.13);
    this.playTone(1046.5, 0.14, 'square', 0.045, 0.195);
  }

  public playBridge(): void {
    this.playTone(330, 0.07, 'triangle', 0.055, 0);
    this.playTone(494, 0.11, 'square', 0.04, 0.07);
  }

  public playDecay(): void {
    this.playTone(240, 0.1, 'sawtooth', 0.03, 0, 140);
  }

  public playMonthClose(): void {
    this.playTone(440, 0.05, 'triangle', 0.035, 0);
    this.playTone(587.33, 0.09, 'triangle', 0.035, 0.05);
  }

  public playEmergency(): void {
    this.playTone(587.33, 0.06, 'square', 0.045, 0);
    this.playTone(783.99, 0.07, 'square', 0.045, 0.06);
    this.playTone(1046.5, 0.12, 'square', 0.045, 0.13);
  }

  public playNewCity(): void {
    this.playTone(392, 0.07, 'square', 0.045, 0);
    this.playTone(523.25, 0.07, 'square', 0.045, 0.075);
    this.playTone(659.25, 0.14, 'square', 0.05, 0.15);
  }
}

export const soundEngine = new RetroSoundEngine();
