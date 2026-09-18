import type { Role, StockEvent } from '../../types'
import type { CalendarItem } from './types'

/**
 * What a person may do to an item, as buttons in the drawer.
 *
 * Mirrors firestore.rules (eventEdit, createdHonestly, staffDeletable), which is where the
 * answer is enforced. A manager or admin sets tasks up, edits, re-dates, cancels, signs
 * off and sends back. Staff move a task that is theirs — assigned to them, to everyone,
 * or to nobody in particular — forward: start it, finish it. Derived items have no state
 * of their own, so their only actions open the record they came from.
 */

export type ItemAction =
  | 'start'
  | 'complete'
  | 'approve'
  | 'reopen'
  | 'edit'
  | 'reschedule'
  | 'cancel'
  | 'delete'
  | 'open'
  | 'receive'
  | 'createPR'

export interface Actor {
  id: string
  role: Role
}

export function canManageTasks(role: Role): boolean {
  return role === 'admin' || role === 'manager'
}

/** The rules' assignedToMe(): named, or everyone, or nobody in particular. */
export function isAssignedTo(e: Pick<StockEvent, 'assignedTo' | 'assignedToAll'>, uid: string): boolean {
  if (e.assignedToAll) return true
  const to = e.assignedTo as string[] | string | undefined
  if (to === undefined || (Array.isArray(to) && to.length === 0)) return true
  return Array.isArray(to) ? to.includes(uid) : to === uid
}

export function taskActions(e: StockEvent, actor: Actor): ItemAction[] {
  const out: ItemAction[] = []
  const manager = canManageTasks(actor.role)
  const open = e.status === 'upcoming' || e.status === 'inProgress'
  const mine = manager || isAssignedTo(e, actor.id)
  if (mine && e.status === 'upcoming') out.push('start')
  if (mine && open) out.push('complete')
  if (manager && e.status === 'waitingApproval') out.push('approve', 'reopen')
  if (manager && e.status === 'completed') out.push('reopen')
  if (manager) {
    if (open || e.status === 'waitingApproval') out.push('edit', 'reschedule', 'cancel')
    // A generated task is cancelled, not deleted: the schedule would only write it again.
    // A hand-made one goes if its author (or an admin) says so.
    const generated = e.sourceType === 'schedule'
    if (!generated && (actor.role === 'admin' || e.createdBy === actor.id)) out.push('delete')
  }
  return out
}

export function actionsFor(item: CalendarItem, actor: Actor | null): ItemAction[] {
  if (!actor) return []
  switch (item.meta.kind) {
    case 'task':
      return taskActions(item.meta.event, actor)
    case 'poExpected':
      return item.meta.order.status === 'ordered' ? ['open', 'receive'] : ['open']
    case 'prPending':
    case 'cutoff':
    case 'adjustment':
    case 'waste':
    case 'stockoutEstimate':
      return ['open']
    case 'lowStock':
    case 'outOfStock':
    case 'reorder':
      return ['open', 'createPR']
  }
}
