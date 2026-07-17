import { useMemo, useState } from 'react'
import type { Product } from '../types'
import { ProductThumb } from './ProductThumb'
import { QtyInput } from './QtyInput'
import { Input } from './ui'
import { fmtQty } from '../lib/format'

export interface Line {
  productId: string
  productName: string
  unit: string
  qty: number
}

export function LineBuilder({
  products,
  lines,
  onChange,
  availableAt,
}: {
  products: Product[]
  lines: Line[]
  onChange: (lines: Line[]) => void
  /** optional: show current on-hand at source location + block over-issue */
  availableAt?: (productId: string) => number
}) {
  const [search, setSearch] = useState('')

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    const chosen = new Set(lines.map((l) => l.productId))
    return products
      .filter((p) => !chosen.has(p.id))
      .filter(
        (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [search, products, lines])

  function addProduct(p: Product) {
    onChange([...lines, { productId: p.id, productName: p.name, unit: p.unitType, qty: 1 }])
    setSearch('')
  }

  function setQty(id: string, qty: number) {
    onChange(lines.map((l) => (l.productId === id ? { ...l, qty } : l)))
  }

  function remove(id: string) {
    onChange(lines.filter((l) => l.productId !== id))
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Input
          placeholder="🔍 ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / SKU)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {matches.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {matches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addProduct(p)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <ProductThumb productId={p.id} hasImage={p.hasImage} size={32} />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-xs text-slate-400">{p.sku}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {lines.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
          ยังไม่มีรายการ — ค้นหาด้านบนเพื่อเพิ่มสินค้า
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {lines.map((l) => {
            const avail = availableAt?.(l.productId)
            const over = avail !== undefined && l.qty > avail
            return (
              <div key={l.productId} className="flex items-center gap-2 p-2 sm:gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">
                    {l.productName}
                  </div>
                  {avail !== undefined && (
                    <div className={`text-xs ${over ? 'text-rose-600' : 'text-slate-400'}`}>
                      คงเหลือต้นทาง: {fmtQty(avail)} {l.unit}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="w-40 sm:w-44">
                    <QtyInput
                      unitType={l.unit}
                      value={l.qty}
                      onChange={(v) => setQty(l.productId, v)}
                      invalid={over}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(l.productId)}
                    className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    aria-label="ลบ"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
