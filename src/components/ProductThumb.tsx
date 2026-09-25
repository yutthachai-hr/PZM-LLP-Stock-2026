import { useEffect, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import { BRANDS, brandDef } from '../brand/brand'
import { useBrand } from '../brand/BrandContext'
import { useData } from '../data/DataContext'
import { useT } from '../i18n/I18nContext'
import { forgetProductImage, loadProductImage, photoKey } from '../services/productImageCache'
import { ImageViewer } from './ImageViewer'

// Two layers of cache, so a photo is read from Firestore once per device, not once per
// screen or per visit (owner, 26 Sep 2026 — the free tier's 50,000 reads a day):
//
//  - in memory, for re-renders and list scrolls within this visit;
//  - on the device (services/productImageCache), across visits, until the photo changes.
//
// Keyed by brand as well as product: both brands number their products independently, so
// the same id in Le Lapin used to show Pizza Mania's photo. The version is the product's
// `updatedAt`, which setting or removing a photo bumps, so another device's new photo is
// fetched as soon as the product's change arrives. A revision counter bumps every time an
// image is replaced here, which is what makes thumbnails that are already on screen reload.
const cache = new Map<string, string | null>()
let revision = 0
const watchers = new Set<() => void>()

export function ProductThumb({
  productId,
  hasImage,
  size = 40,
  zoom = true,
}: {
  productId: string
  hasImage: boolean
  size?: number
  /** Tap to see it large. Off where the thumbnail sits inside a button that picks the product. */
  zoom?: boolean
}) {
  const t = useT()
  const { brand } = useBrand()
  const { productById, loading } = useData()
  const version = productById(productId)?.updatedAt
  const key = `${photoKey(brand, productId)}@${version ?? '?'}`
  const [url, setUrl] = useState<string | null>(cache.get(key) ?? null)
  const [rev, setRev] = useState(revision)
  const [large, setLarge] = useState(false)

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
    // The product list is still arriving: wait for its version rather than spend a read on
    // a copy this device may already have.
    if (version === undefined && loading) return
    loadProductImage(brand, productId, version)
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
  }, [brand, productId, hasImage, version, loading, key, rev])

  const style = { width: size, height: size }
  if (!url) {
    return (
      <div
        style={style}
        className="flex shrink-0 items-center justify-center rounded-lg border border-dashed border-line bg-sunken text-ink-faint"
      >
        {brand ? brandDef(brand).productIcon : '📦'}
      </div>
    )
  }
  if (!zoom) {
    return <img src={url} alt="" style={style} className="shrink-0 rounded-lg border border-line object-cover" />
  }

  // The thumbnail often sits in a clickable row or a link; opening the photo must not also
  // open the product or follow the link.
  const open = (e: SyntheticEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setLarge(true)
  }
  return (
    <>
      <img
        src={url}
        alt={t('ดูรูปขยาย')}
        title={t('ดูรูปขยาย')}
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') open(e)
        }}
        style={style}
        className="shrink-0 cursor-zoom-in rounded-lg border border-line object-cover outline-none transition-[box-shadow,transform] duration-150 hover:scale-105 hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand/40"
      />
      {large && <ImageViewer src={url} productId={productId} onClose={() => setLarge(false)} />}
    </>
  )
}

/**
 * Forget a cached image after it changes, and tell mounted thumbnails to fetch it again.
 *
 * Clearing the map alone was not enough: a thumbnail already on screen has the same product
 * id and the same hasImage flag, so nothing in its effect changed and it kept the old
 * picture. The revision counter is the thing that does change. The copy on this device goes
 * too — for either brand, since the id alone does not say which.
 */
export function invalidateThumb(productId: string) {
  revision++
  for (const key of [...cache.keys()]) {
    if (key.includes(`::${productId}@`)) cache.delete(key)
  }
  forgetProductImage(productId, BRANDS.map((b) => b.id))
  for (const notify of [...watchers]) notify()
}

/**
 * Drop the photos held in memory. Called on sign-out, since the device is shared.
 *
 * The copies on the device stay: they are the company's product photos, the same for
 * whoever signs in next, and wiping them at every sign-out would bring back the reads they
 * exist to save (an idle sign-out that wiped the offline copy is what ran the quota out on
 * 14 Sep 2026).
 */
export function clearThumbCache(): void {
  cache.clear()
  revision++
  for (const notify of [...watchers]) notify()
}
