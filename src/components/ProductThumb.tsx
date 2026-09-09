import { useEffect, useState } from 'react'
import { getProductImage } from '../services/products'
import { brandDef } from '../brand/brand'
import { useBrand } from '../brand/BrandContext'

// In-memory cache so re-renders and list scrolls do not re-fetch the same image.
//
// Keyed by brand as well as product: both brands number their products independently, so
// the same id in Le Lapin used to show Pizza Mania's photo. A revision counter bumps every
// time an image is replaced, which is what makes thumbnails that are already on screen
// reload instead of showing the old picture until the page is left and come back to.
const cache = new Map<string, string | null>()
let revision = 0
const watchers = new Set<() => void>()

function cacheKey(brand: string | null | undefined, productId: string): string {
  return `${brand ?? '-'}::${productId}`
}

export function ProductThumb({
  productId,
  hasImage,
  size = 40,
  onClick,
}: {
  productId: string
  hasImage: boolean
  size?: number
  onClick?: () => void
}) {
  const { brand } = useBrand()
  const key = cacheKey(brand, productId)
  const [url, setUrl] = useState<string | null>(cache.get(key) ?? null)
  const [rev, setRev] = useState(revision)

  // Re-render this thumbnail when any image is replaced anywhere.
  useEffect(() => {
    const notify = () => setRev(revision)
    watchers.add(notify)
    return () => {
      watchers.delete(notify)
    }
  }, [])

  useEffect(() => {
    let on = true
    if (!hasImage) {
      setUrl(null)
      return
    }
    if (cache.has(key)) {
      setUrl(cache.get(key) ?? null)
      return
    }
    getProductImage(productId)
      .then((u) => {
        // Only cache under the key this request was made for; a brand switch mid-fetch
        // would otherwise file one brand's photo under the other's.
        cache.set(key, u)
        if (on) setUrl(u)
      })
      .catch(() => {
        if (on) setUrl(null)
      })
    return () => {
      on = false
    }
  }, [productId, hasImage, key, rev])

  const style = { width: size, height: size }
  if (url) {
    return (
      <img
        src={url}
        alt=""
        onClick={onClick}
        style={style}
        className="shrink-0 rounded-lg border border-line object-cover"
      />
    )
  }
  return (
    <div
      onClick={onClick}
      style={style}
      className="flex shrink-0 items-center justify-center rounded-lg border border-dashed border-line bg-sunken text-ink-faint"
    >
      {brand ? brandDef(brand).productIcon : '📦'}
    </div>
  )
}

/**
 * Forget a cached image after it changes, and tell mounted thumbnails to fetch it again.
 *
 * Clearing the map alone was not enough: a thumbnail already on screen has the same product
 * id and the same hasImage flag, so nothing in its effect changed and it kept the old
 * picture. The revision counter is the thing that does change.
 */
export function invalidateThumb(productId: string) {
  revision++
  for (const key of [...cache.keys()]) {
    if (key.endsWith(`::${productId}`)) cache.delete(key)
  }
  for (const notify of [...watchers]) notify()
}

/** Drop every cached photo. Called on sign-out, since the device is shared. */
export function clearThumbCache(): void {
  cache.clear()
  revision++
  for (const notify of [...watchers]) notify()
}
