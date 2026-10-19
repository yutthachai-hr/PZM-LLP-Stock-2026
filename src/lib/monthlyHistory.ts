import type { StockMovement } from '../types'

/**
 * End of time. The rewind read must not stop short of a row that exists: the old
 * device-clock horizon of today + 400 days (audit D-2) dropped any row dated past it, so
 * the day-end figure — and the adjustment posted from it — was wrong by that row's effect.
 */
export const MOVEMENTS_CEILING = Number.MAX_SAFE_INTEGER

/**
 * The movement rows a count's day-end figure is derived from: everything dated at or
 * after the cut, with no upper horizon. `balanceAtDayEnd` ignores what falls after the
 * day it is asked about, so an open-ended window is always at least as correct as a
 * bounded one — and never silently short.
 */
export function rewindRange(cut: number): { from: number; to: number } {
  return { from: cut, to: MOVEMENTS_CEILING }
}

export type RewindState =
  | { status: 'idle' }
  | { status: 'loading'; cut: number; ticket: string }
  | { status: 'ready'; cut: number; ticket: string; rows: StockMovement[] }
  | { status: 'error'; cut: number; ticket: string; message: string }

/** A request's identity: the brand and cut it was read for, plus the attempt number. */
export function rewindTicket(brand: string, cut: number, attempt: number): string {
  return `${brand}::${cut}::${attempt}`
}

export function rewindLoading(cut: number, ticket: string): RewindState {
  return { status: 'loading', cut, ticket }
}

export function rewindLoaded(cut: number, ticket: string, rows: StockMovement[]): RewindState {
  return { status: 'ready', cut, ticket, rows }
}

export function rewindFailed(cut: number, ticket: string, message: string): RewindState {
  return { status: 'error', cut, ticket, message }
}

/** Fold an answer in only when it belongs to the request in flight. */
export function acceptRewind(current: RewindState, answer: RewindState): RewindState {
  if (answer.status === 'idle') return current
  if (current.status === 'idle') return current
  return answer.ticket === current.ticket ? answer : current
}

/** May the figures be shown, exported or submitted? A backdated sheet needs a complete rewind. */
export function mayUseFigures(backdated: boolean, state: RewindState, ticket: string): boolean {
  return !backdated || (state.status === 'ready' && state.ticket === ticket)
}
