/**
 * Which page of a multi-page order sheet has been shared, kept across a reload (owner P0,
 * 22 Oct 2026). A phone often drops the page while LINE is in front; without this the wizard
 * came back on page 1 and the person shared it again. Local storage, because a home-screen app
 * killed in the background loses session storage too. A day is plenty: older progress is stale.
 */
const KEY = 'pmstock:v1:send-progress'
const TTL_MS = 86_400_000

type Progress = Record<string, { page: number; at: number }>

function read(): Progress {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Progress
  } catch {
    return {}
  }
}

function write(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* private mode: progress is a convenience, the order status is the record */
  }
}

const key = (brand: string, orderId: string) => `${brand}:${orderId}`

/** The next page to share for this order, or 0. Never beyond the order's last page. */
export function pageToResume(brand: string, orderId: string, pages: number, now = Date.now()): number {
  const p = read()[key(brand, orderId)]
  if (!p || now - p.at > TTL_MS || p.page < 1) return 0
  return Math.min(p.page, Math.max(pages - 1, 0))
}

export function savePageProgress(brand: string, orderId: string, page: number, now = Date.now()): void {
  const all = read()
  for (const [k, v] of Object.entries(all)) if (now - v.at > TTL_MS) delete all[k]
  all[key(brand, orderId)] = { page, at: now }
  write(all)
}

export function clearPageProgress(brand: string, orderId: string): void {
  const all = read()
  if (!(key(brand, orderId) in all)) return
  delete all[key(brand, orderId)]
  write(all)
}
