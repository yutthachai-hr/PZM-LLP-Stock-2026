import type { Role } from '../../types'
import type { CalendarItem } from './types'

/**
 * What a person may do to an item, as buttons in the drawer.
 *
 * Mirrors firestore.rules, which is where the answer is enforced: an admin may create,
 * edit, cancel and delete tasks; anyone may start and finish one. (The manager role joins
 * the editors when the rules do — see HANDOFF.) Derived items have no state of their own,
 * so their only actions open the record they came from.
 */

export type ItemAction =
  | 'start'
  | 'complete'
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
  return role === 'admin'
}

export function actionsFor(item: CalendarItem, actor: Actor | null): ItemAction[] {
  if (!actor) return []
  switch (item.meta.kind) {
    case 'task': {
      const e = item.meta.event
      const out: ItemAction[] = []
      const open = e.status === 'upcoming' || e.status === 'inProgress'
      if (e.status === 'upcoming') out.push('start')
      if (open) out.push('complete')
      if (canManageTasks(actor.role)) {
        out.push('edit')
        if (open) out.push('reschedule', 'cancel')
        out.push('delete')
      }
      return out
    }
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
