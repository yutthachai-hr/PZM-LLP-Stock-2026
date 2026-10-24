import { matchPath } from 'react-router-dom'

// Stored notifications outlive their writer: before R63 transfers linked to /logistics/:id.
// Keep this list in step with App.tsx (asserted by notification-link.test.ts), not the catch-all.
export const NOTIFICATION_ROUTES = [
  '/', '/products', '/products/:id/card', '/receive', '/issue', '/recipes',
  '/transfers', '/transfers/today', '/transfers/new', '/transfers/:id/receive', '/transfers/:id',
  '/adjust', '/counts', '/counts/:id', '/movements', '/reports', '/import',
  '/suppliers', '/suppliers/performance', '/orders', '/requests', '/requests/:id',
  '/purchase', '/purchase/import', '/purchase/:id', '/calendar', '/announcements',
  '/announcements/new', '/announcements/:company/:id', '/settings', '/settings/:section', '/more',
] as const

/** Canonical local route, or null: never navigate or mark read for a refused destination. */
export function canonicalLink(link: unknown): string | null {
  if (typeof link !== 'string' || !link.startsWith('/') || link.startsWith('//')) return null
  if (/[\\\s\p{Cc}]/u.test(link)) return null
  const cut = link.search(/[?#]/)
  let path = cut < 0 ? link : link.slice(0, cut)
  const rest = cut < 0 ? '' : link.slice(cut)
  try {
    const decodedUri = decodeURI(link) // malformed percent encoding must not crash presentation or the router
    if (/[\\\p{Cc}]/u.test(decodedUri)) return null
    if (path.split('/').slice(1).some((p) => {
      const decoded = decodeURIComponent(p)
      return decoded === '.' || decoded === '..' || /[%/\\\s?#\p{Cc}]/u.test(decoded)
    })) return null
  } catch {
    return null
  }
  if (path.length > 1) path = path.replace(/\/+$/, '')
  if (path === '/logistics') path = '/transfers'
  else if (/^\/logistics\/[^/]+$/.test(path)) path = path.replace('/logistics/', '/transfers/')
  if (!NOTIFICATION_ROUTES.some((p) => matchPath({ path: p, end: true, caseSensitive: true }, path))) return null
  // Transfer IDs are only meaningful in the currently open company's namespace.
  if (path.startsWith('/transfers') && [...new URLSearchParams(rest.split('#')[0].replace(/^\?/, '')).keys()]
    .some((k) => /^(brand|brandId|company)$/i.test(k))) return null
  return path + rest
}
