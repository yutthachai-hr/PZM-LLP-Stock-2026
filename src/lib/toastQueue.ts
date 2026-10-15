export type ToastKind = 'success' | 'error' | 'warning' | 'info'
export interface ToastContent {
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}
export type ToastInput = string | ToastContent
export interface ToastRecord extends ToastContent { id: number; kind: ToastKind }
export const TOAST_DURATION: Record<ToastKind, number> = { success: 3000, info: 4000, warning: 6500, error: 8000 }
export const MAX_VISIBLE = 3
export const MAX_QUEUED = 20

export function normalizeToast(input: ToastInput, description?: string): ToastContent | null {
  const content = typeof input === 'string' ? { title: input, description } : input
  const title = content.title.trim()
  if (!title) return null
  const details = content.description?.trim()
  return { title, ...(details ? { description: details } : {}), ...(content.action ? { action: content.action } : {}) }
}

export function enqueueToast(items: ToastRecord[], next: ToastRecord): ToastRecord[] {
  if (!next.action && items.some((item) => !item.action && item.kind === next.kind && item.title === next.title && item.description === next.description)) return items
  // Preserve the displayed head; on a unique-message flood discard the oldest waiting entry.
  const retained = items.length >= MAX_QUEUED ? [...items.slice(0, MAX_VISIBLE), ...items.slice(MAX_VISIBLE + 1)] : items
  return [...retained, next]
}

export function visibleToasts(items: ToastRecord[], operationalCount: number): ToastRecord[] {
  return items.slice(0, Math.max(0, MAX_VISIBLE - Math.max(0, operationalCount)))
}
