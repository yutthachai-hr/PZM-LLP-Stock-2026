import type { NotificationCategory } from '../types'
import { SEVERITY_RANK, type PresentedNotification, type Severity, type SoundName } from './notificationPresentation'

/**
 * Which arriving notifications become popups, and how many at once (5 Oct 2026). Pure
 * state transitions, so the rules — history never pops, a reconnect never repeats one, a
 * burst becomes one card with one sound — are tested without a browser.
 *
 * The first snapshot after sign-in is the baseline: all of it is history. After that, a
 * notification pops once per session, and only if it is recent (a reconnect re-delivering
 * week-old documents pops nothing).
 */

export const MAX_VISIBLE = 3
/** Arrivals this close together are one burst. */
export const BURST_WINDOW_MS = 1500
/** This many of one category in a burst collapse into a single summary card. */
export const BURST_COLLAPSE_AT = 3
/** Older than this on arrival is history, whatever the listener says. */
export const FRESH_MS = 10 * 60_000

/**
 * Every popup leaves after four seconds, critical included (owner, 6 Oct 2026: "หายไปหลัง
 * จากผ่านไป 4 วินาที"). Nothing is lost — the bell keeps each one, unread, until opened.
 */
export const AUTO_DISMISS_MS: Record<Severity, number | null> = {
  info: 4_000,
  success: 4_000,
  warning: 4_000,
  critical: 4_000,
}

/** Cards that appear together leave one after another, top first, this far apart. */
export const STAGGER_MS = 400
/** How long a card takes to fade and slide out to the right. */
export const LEAVE_MS = 300

export interface PopupCard {
  /** The occurrence (id@armedAt), or `burst:<category>:<first occurrence>` for a summary. */
  key: string
  severity: Severity
  /** The notifications behind it (one, or the burst's). */
  items: PresentedNotification[]
  category: NotificationCategory | null
  shownAt: number | null
  /** ms after shownAt to remove it; null = sticky. */
  ttl: number | null
}

export interface QueueState {
  /** Null until the first snapshot is in. */
  seen: Set<string> | null
  /**
   * When this person's app began listening. Only what was created before it is the
   * baseline; anything newer is news even if it rides in on the first snapshot.
   */
  openedAt?: number
  visible: PopupCard[]
  waiting: PopupCard[]
}

export const emptyQueue = (openedAt?: number): QueueState => ({ seen: null, visible: [], waiting: [], ...(openedAt === undefined ? {} : { openedAt }) })

/**
 * The listener delivered `incoming` (the whole current list, already filtered to this
 * user). Returns the next state and the new cards to consider for sound.
 */
export function receive(
  state: QueueState,
  incoming: readonly { presented: PresentedNotification; category: NotificationCategory }[],
  now: number,
): { state: QueueState; fresh: PopupCard[] } {
  if (state.seen === null) {
    // The first snapshot is the baseline: what was there before is not news. But only what
    // was there BEFORE the app opened — the first snapshot can take seconds on a slow start,
    // and an alert written meanwhile used to be swallowed into the baseline, never popping
    // or sounding (found by e2e business-flow, 8 Oct 2026: the supplier's date change).
    const since = state.openedAt
    const before = since === undefined ? incoming : incoming.filter((i) => i.presented.createdAt < since)
    state = { ...state, seen: new Set(before.map((i) => i.presented.occurrence)) }
    if (before.length === incoming.length) return { state, fresh: [] }
  }
  const seen = new Set(state.seen ?? [])
  const arrivals: typeof incoming[number][] = []
  for (const i of incoming) {
    if (seen.has(i.presented.occurrence)) continue
    seen.add(i.presented.occurrence)
    if (!i.presented.popup) continue
    if (now - i.presented.createdAt > FRESH_MS) continue
    arrivals.push(i)
  }
  if (!arrivals.length) return { state: { ...state, seen }, fresh: [] }

  // Collapse a burst per category; the rest pop one by one. A critical one is never folded
  // into a summary — it is the one thing that must be seen on its own.
  const byCat = new Map<NotificationCategory, typeof arrivals>()
  const cards: PopupCard[] = []
  for (const a of arrivals) {
    if (a.presented.severity === 'critical') {
      cards.push({ key: a.presented.occurrence, severity: 'critical', items: [a.presented], category: a.category, shownAt: null, ttl: AUTO_DISMISS_MS.critical })
    } else byCat.set(a.category, [...(byCat.get(a.category) ?? []), a])
  }
  for (const [category, list] of byCat) {
    if (list.length >= BURST_COLLAPSE_AT) {
      const items = list.map((l) => l.presented)
      const severity = items.reduce<Severity>((s, i) => (SEVERITY_RANK[i.severity] > SEVERITY_RANK[s] ? i.severity : s), 'info')
      cards.push({ key: `burst:${category}:${items[0].occurrence}`, severity, items, category, shownAt: null, ttl: AUTO_DISMISS_MS[severity] })
    } else {
      for (const l of list) {
        cards.push({ key: l.presented.occurrence, severity: l.presented.severity, items: [l.presented], category, shownAt: null, ttl: AUTO_DISMISS_MS[l.presented.severity] })
      }
    }
  }
  // Most severe first, so a critical one is never the one left waiting.
  cards.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
  return { state: fill({ seen, visible: state.visible, waiting: [...state.waiting, ...cards] }, now), fresh: cards }
}

/** Move waiting cards into the visible stack while there is room. */
function fill(state: QueueState, now: number): QueueState {
  const visible = [...state.visible]
  const waiting = [...state.waiting].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
  // Shown in the same moment: the lower ones wait a little longer, so they leave top first.
  let k = 0
  while (visible.length < MAX_VISIBLE && waiting.length) {
    const card = waiting.shift()!
    visible.push({ ...card, shownAt: now, ttl: card.ttl === null ? null : card.ttl + k++ * STAGGER_MS })
  }
  return { ...state, visible, waiting }
}

export function dismiss(state: QueueState, key: string, now: number): QueueState {
  return fill({ ...state, visible: state.visible.filter((c) => c.key !== key), waiting: state.waiting.filter((c) => c.key !== key) }, now)
}

/** Remove cards whose time is up. Sticky (critical) cards stay. */
/** Cards whose time is up and that should start leaving (the host animates, then dismisses). */
export function dueCards(state: QueueState, now: number): string[] {
  return state.visible.filter((c) => c.ttl !== null && c.shownAt !== null && now - c.shownAt >= c.ttl).map((c) => c.key)
}

export function expire(state: QueueState, now: number): QueueState {
  const visible = state.visible.filter((c) => c.ttl === null || c.shownAt === null || now - c.shownAt < c.ttl)
  return visible.length === state.visible.length ? state : fill({ ...state, visible }, now)
}

/** The one sound for a batch of new cards: the most severe that has one. */
export function soundFor(cards: readonly PopupCard[]): SoundName | null {
  let best: SoundName | null = null
  for (const c of cards) {
    for (const i of c.items) {
      if (!i.sound) continue
      if (!best || SEVERITY_RANK[i.sound] > SEVERITY_RANK[best]) best = i.sound
    }
  }
  return best
}
