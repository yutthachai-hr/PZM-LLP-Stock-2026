import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../data/DataContext'
import { useT } from '../i18n/I18nContext'
import { fmtQty } from '../lib/format'
import type { Product } from '../types'
import { Icon } from './Icon'
import { LangButton } from './LangButton'
import { ProductThumb } from './ProductThumb'

/**
 * The bar across the top of every screen: find a product, and see what is running out.
 *
 * Until now the only way to reach an item was to open the right page and filter it there —
 * Products to see the balance, History to see what happened to it, each with its own search
 * box and neither reachable from the other. The question people actually arrive with is
 * about a thing, not a page, so the search is global and its results carry the answer to
 * "how much have we got" before you click anything.
 *
 * The bell is the low-stock count. The dashboard has always had that number; it was only
 * visible once you were already looking at the dashboard.
 */

const MAX_RESULTS = 8

export function TopBar({ onMenu, title }: { onMenu: () => void; title: string }) {
  const t = useT()
  const navigate = useNavigate()
  const { products, locations, qtyAt, minFor } = useData()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [mobileSearch, setMobileSearch] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const lowCount = useMemo(() => {
    let n = 0
    for (const p of products) {
      for (const l of locations) {
        const min = minFor(p, l.id)
        if (min > 0 && qtyAt(l.id, p.id) <= min) n++
      }
    }
    return n
  }, [products, locations, qtyAt, minFor])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (needle.length < 2) return []
    const hits: Product[] = []
    for (const p of products) {
      // Hidden products are out of the catalogue's way; their history is still reachable
      // from สินค้าคงคลัง with the "ที่ซ่อนไว้" filter.
      if (p.active === false) continue
      if (p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle)) {
        hits.push(p)
        if (hits.length >= MAX_RESULTS) break
      }
    }
    return hits
  }, [q, products])

  useEffect(() => setActive(0), [q])

  // Close on a click anywhere else. The results overlay the page, so leaving them up while
  // someone reads what is underneath makes the page feel stuck.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function choose(p: Product) {
    setOpen(false)
    setMobileSearch(false)
    setQ('')
    // The stock card: what it is, where it is, and everything that moved it.
    navigate(`/movements?product=${encodeURIComponent(p.id)}`)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false)
      setMobileSearch(false)
      return
    }
    if (results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active])
    }
  }

  const search = (
    <div ref={box} className="relative min-w-0 flex-1 md:max-w-lg">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
        <Icon name="search" size={17} />
      </span>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="topbar-results"
        aria-autocomplete="list"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t('ค้นหาสินค้า หรือรหัสสินค้า…')}
        className="w-full min-h-11 rounded-lg border border-line bg-sunken pl-10 pr-3 text-sm text-ink placeholder:text-ink-faint outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-brand focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-brand/25"
      />
      {open && q.trim().length >= 2 && (
        <div
          id="topbar-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-auto rounded-xl border border-line bg-surface shadow-xl"
        >
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-ink-soft">{t('ไม่พบสินค้า')}</p>
          ) : (
            results.map((p, i) => {
              const total = locations.reduce((s, l) => s + qtyAt(l.id, p.id), 0)
              return (
                <button
                  key={p.id}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(p)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                    i === active ? 'bg-brand-soft' : ''
                  }`}
                >
                  <ProductThumb productId={p.id} hasImage={p.hasImage} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                    <span className="doc-no block truncate text-xs text-ink-faint">{p.sku}</span>
                  </span>
                  <span className="num shrink-0 text-right text-sm font-semibold text-ink">
                    {fmtQty(total)}
                    <span className="ml-1 text-xs font-normal text-ink-faint">{p.unitType}</span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="flex items-center gap-2 px-2 py-2 sm:px-4 lg:px-6">
        {/* The drawer trigger, and the brand stripe that goes with it, only below lg —
            above that the sidebar is on screen and carries both. */}
        <button
          onClick={onMenu}
          className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-soft outline-none transition-colors duration-150 hover:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40 lg:hidden"
          aria-label={t('เมนู')}
        >
          <Icon name="menu" size={22} />
        </button>

        {/* On a phone the field would leave no room for anything else, so it opens over
            the bar instead of sitting in it. */}
        <div className={`min-w-0 flex-1 ${mobileSearch ? '' : 'hidden sm:block'}`}>{search}</div>

        {!mobileSearch && (
          <span className="truncate text-sm font-semibold text-ink sm:hidden">{title}</span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            onClick={() => {
              setMobileSearch((v) => !v)
              setTimeout(() => input.current?.focus(), 0)
            }}
            className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-ink-soft outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40 sm:hidden"
            aria-label={t('ค้นหา')}
          >
            <Icon name={mobileSearch ? 'x' : 'search'} size={20} />
          </button>

          <button
            onClick={() => navigate('/')}
            className="relative inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-ink-soft outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40"
            aria-label={t('สินค้าใกล้หมด ({n} รายการ)', { n: lowCount })}
          >
            <Icon name="warning" size={19} />
            {lowCount > 0 && (
              <span className="num absolute right-1 top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-4 text-white">
                {lowCount > 99 ? '99+' : lowCount}
              </span>
            )}
          </button>

          <LangButton />
        </div>
      </div>
    </header>
  )
}
