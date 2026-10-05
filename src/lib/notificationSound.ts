import type { SoundName } from './notificationPresentation'

/**
 * Notification sounds (5 Oct 2026). Synthesised with Web Audio — short tones, no audio
 * files, nothing for the content-security policy to admit.
 *
 * Browsers start audio "suspended" until the person has touched the page; `unlock()` is
 * wired to the first pointer/key event and resumes it. A sound due before that reports
 * `needs-unlock` so the host can offer a one-time button — that click is the gesture.
 *
 * Nothing here throws. A missing AudioContext, a blocked context, a failed node: the
 * result says so and the popup carries on regardless.
 */

export type PlayResult = 'played' | 'disabled' | 'needs-unlock' | 'unavailable' | 'failed'

/** One note: frequency (Hz), start offset and length (s), and its peak gain (0–1). */
interface Note {
  f: number
  at: number
  len: number
  peak: number
}

/** Short and professional: a chime, a two-tone alert, three quick pulses. Under a second. */
export const TONES: Record<SoundName, Note[]> = {
  success: [
    { f: 660, at: 0, len: 0.12, peak: 0.5 },
    { f: 880, at: 0.11, len: 0.16, peak: 0.5 },
  ],
  warning: [
    { f: 740, at: 0, len: 0.16, peak: 0.6 },
    { f: 740, at: 0.22, len: 0.16, peak: 0.6 },
  ],
  critical: [
    { f: 988, at: 0, len: 0.12, peak: 0.8 },
    { f: 988, at: 0.2, len: 0.12, peak: 0.8 },
    { f: 988, at: 0.4, len: 0.2, peak: 0.8 },
  ],
}

type Ctx = Pick<AudioContext, 'state' | 'currentTime' | 'destination' | 'resume' | 'createOscillator' | 'createGain'>

export interface SoundManager {
  play(name: SoundName, opts: { enabled: boolean; volume: number }): PlayResult
  /** Resume the context; call from a user gesture. Resolves true when audio can play. */
  unlock(): Promise<boolean>
  readonly unlocked: boolean
}

export function createSoundManager(makeContext: () => Ctx | null = defaultContext): SoundManager {
  let ctx: Ctx | null = null
  let tried = false
  const get = (): Ctx | null => {
    if (!tried) {
      tried = true
      try {
        ctx = makeContext()
      } catch {
        ctx = null
      }
    }
    return ctx
  }

  return {
    get unlocked() {
      return ctx?.state === 'running'
    },
    async unlock() {
      const c = get()
      if (!c) return false
      try {
        if (c.state !== 'running') await c.resume()
        return c.state === 'running'
      } catch {
        return false
      }
    },
    play(name, { enabled, volume }) {
      if (!enabled || volume <= 0) return 'disabled'
      const c = get()
      if (!c) return 'unavailable'
      if (c.state !== 'running') return 'needs-unlock'
      try {
        const v = Math.min(1, Math.max(0, volume))
        const t0 = c.currentTime + 0.01
        for (const n of TONES[name]) {
          const osc = c.createOscillator()
          const gain = c.createGain()
          osc.type = 'sine'
          osc.frequency.value = n.f
          // A quick attack and an exponential tail: a tone, not a click.
          gain.gain.setValueAtTime(0.0001, t0 + n.at)
          gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, n.peak * v * 0.4), t0 + n.at + 0.015)
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len)
          osc.connect(gain)
          gain.connect(c.destination)
          osc.start(t0 + n.at)
          osc.stop(t0 + n.at + n.len + 0.02)
        }
        return 'played'
      } catch {
        return 'failed'
      }
    },
  }
}

function defaultContext(): Ctx | null {
  if (typeof window === 'undefined') return null
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return C ? new C() : null
}

/** The app's one manager. */
export const notificationSound = createSoundManager()
