export type ToastKind = 'success' | 'error' | 'warning' | 'info'
export interface ToastContent {
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}
export type ToastInput = string | Error | ToastContent
export interface ToastRecord extends ToastContent { id: number; kind: ToastKind; revision?: number }
export const TOAST_DURATION: Record<ToastKind, number> = { success: 3000, info: 4000, warning: 6500, error: 8000 }
export const MAX_VISIBLE = 3
export const MAX_QUEUED = 20

export function normalizeToast(input: ToastInput, description?: string, fallbackTitle = 'Error'): ToastContent | null {
  // ponytail: the pure queue keeps an English default; ToastProvider passes t()'s localized
  // fallback for the one reachable case, an Error thrown with an empty message.
  if (input instanceof Error) {
    const title = input.message.trim() || fallbackTitle
    const details = description?.trim()
    return { title, ...(details ? { description: details } : {}) }
  }
  const content = typeof input === 'string' ? { title: input, description } : input
  const title = content.title.trim()
  if (!title) return null
  const details = content.description?.trim()
  return { title, ...(details ? { description: details } : {}), ...(content.action ? { action: content.action } : {}) }
}

export function enqueueToast(items: ToastRecord[], next: ToastRecord): ToastRecord[] {
  const duplicate = !next.action ? items.findIndex((item) => !item.action && item.kind === next.kind && item.title === next.title && item.description === next.description) : -1
  if (duplicate >= 0) {
    if (next.kind !== 'error') return items
    // A failed retry needs a full reading interval. Keep its slot and id so focus stays put.
    return items.map((item, index) => index === duplicate ? { ...item, revision: (item.revision ?? 0) + 1 } : item)
  }
  // Preserve the displayed head; on a unique-message flood discard the oldest waiting entry.
  const retained = items.length >= MAX_QUEUED ? [...items.slice(0, MAX_VISIBLE), ...items.slice(MAX_VISIBLE + 1)] : items
  return [...retained, next]
}

export function visibleToasts(items: ToastRecord[], operationalCount: number): ToastRecord[] {
  return items.slice(0, Math.max(0, MAX_VISIBLE - Math.max(0, operationalCount)))
}
