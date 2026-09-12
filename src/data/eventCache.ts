import { getBrand } from '../brand/brand'
import { listEventsInRange } from '../services/events'
import type { StockEvent } from '../types'

/**
 * One place that remembers which date ranges of the calendar have already been paid for.
 *
 * Calendar events are not subscribed — see src/services/events.ts for why — so every month
 * someone looks at is a query. Without a cache, paging September → October → September
 * costs three, and the nav badge asking "anything today?" costs a fourth for a range the
 * calendar has usually already loaded.
 *
 * Module level rather than React state because two unrelated parts of the app want the
 * same answer: the badge in the sidebar and the calendar screen. Keyed by brand, so
 * switching company cannot show the other one's plan — stale entries for a brand nobody
 * is looking at are simply never read again.
 *
 * A write patches the cache in place instead of invalidating it. Re-reading a month
 * because one event in it changed is exactly the cost this file exists to avoid.
 */

const ranges = new Map<string, StockEvent[]>()

/**
 * Anything rendering a count off this cache, so a write updates it without a read.
 *
 * The menu badge reads today's range once per session. Without this it kept the number it
 * first saw, so scheduling two things for today left the badge saying zero — which reads
 * as broken rather than as cached.
 */
const listeners = new Set<() => void>()

export function subscribeCache(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function announce(): void {
  for (const fn of listeners) fn()
}

/** What is held for a range right now, without fetching. */
export function peekRange(from: number, to: number): StockEvent[] | undefined {
  return ranges.get(key(from, to))
}

function key(from: number, to: number): string {
  return `${getBrand()}|${from}|${to}`
}

/** Events in [from, to], from cache when it has been read before. */
export async function fetchRange(
  from: number,
  to: number,
  opts?: { force?: boolean },
): Promise<StockEvent[]> {
  const k = key(from, to)
  if (!opts?.force) {
    const hit = ranges.get(k)
    if (hit) return hit
  }
  const rows = await listEventsInRange(from, to)
  ranges.set(k, rows)
  announce()
  return rows
}

/** True when this range is already in memory — used to skip a loading state. */
export function hasRange(from: number, to: number): boolean {
  return ranges.has(key(from, to))
}

function sort(rows: StockEvent[]): StockEvent[] {
  return rows.sort((a, b) => a.startAt - b.startAt || a.title.localeCompare(b.title))
}

/**
 * Fold a created or changed event into every cached range it belongs to, and out of the
 * ones it no longer does — an edit can move its date across a month boundary.
 */
export function patchEvent(event: StockEvent): void {
  const prefix = `${getBrand()}|`
  for (const [k, rows] of ranges) {
    if (!k.startsWith(prefix)) continue
    const [, fromStr, toStr] = k.split('|')
    const from = Number(fromStr)
    const to = Number(toStr)
    const belongs = event.startAt >= from && event.startAt <= to
    const without = rows.filter((r) => r.id !== event.id)
    ranges.set(k, belongs ? sort([...without, event]) : without)
  }
  announce()
}

export function removeEvent(id: string): void {
  const prefix = `${getBrand()}|`
  for (const [k, rows] of ranges) {
    if (!k.startsWith(prefix)) continue
    ranges.set(
      k,
      rows.filter((r) => r.id !== id),
    )
  }
  announce()
}

/** Used by tests, and by anything that has reason to distrust what is held. */
export function clearEventCache(): void {
  ranges.clear()
  announce()
}
