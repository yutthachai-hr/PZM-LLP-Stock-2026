import { useEffect, useState } from 'react'
import { getProductImage } from '../services/products'

// Simple in-memory cache so re-renders / list scrolls don't re-fetch the same image.
const cache = new Map<string, string | null>()

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
  const [url, setUrl] = useState<string | null>(cache.get(productId) ?? null)

  useEffect(() => {
    let on = true
    if (!hasImage) {
      setUrl(null)
      return
    }
    if (cache.has(productId)) {
      setUrl(cache.get(productId) ?? null)
      return
    }
    getProductImage(productId).then((u) => {
      cache.set(productId, u)
      if (on) setUrl(u)
    })
    return () => {
      on = false
    }
  }, [productId, hasImage])

  const style = { width: size, height: size }
  if (url) {
    return (
      <img
        src={url}
        alt=""
        onClick={onClick}
        style={style}
        className="shrink-0 rounded-lg border border-slate-200 object-cover"
      />
    )
  }
  return (
    <div
      onClick={onClick}
      style={style}
      className="flex shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-300"
    >
      🍕
    </div>
  )
}

/** Clear a cached image after it changes so the new one loads. */
export function invalidateThumb(productId: string) {
  cache.delete(productId)
}
