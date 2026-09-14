import { useCallback, useEffect, useMemo, useState } from 'react'
import { useData } from '../../data/DataContext'
import { useEntryUnits } from '../../services/entryUnits'
import { listAliases } from '../../services/productAliases'
import { HISTORY_DAYS, type AssessContext } from '../../services/purchaseBatch'
import { listOrdersInRange } from '../../services/purchaseOrders'
import { listSupplierItems, listSuppliers } from '../../services/suppliers'
import type { ProductAlias } from '../../lib/productMatch'
import type { PurchaseOrder, Supplier, SupplierItem } from '../../types'

/**
 * Everything the batch screens need to judge a row, read once when the screen opens.
 *
 * The catalogue and the unit list are already in memory. The rest — suppliers, price rows,
 * confirmed spellings, ninety days of orders — is a few hundred documents, read here and
 * not subscribed, because these screens are opened deliberately a couple of times a week.
 */
export function useAssessContext(): {
  ctx: AssessContext | null
  aliases: ProductAlias[]
  suppliers: Supplier[]
  supplierItems: SupplierItem[]
  recentOrders: PurchaseOrder[]
  loading: boolean
  error: unknown
  reload: () => Promise<void>
} {
  const { products } = useData()
  const plainUnits = useEntryUnits()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierItems, setSupplierItems] = useState<SupplierItem[]>([])
  const [aliases, setAliases] = useState<ProductAlias[]>([])
  const [recentOrders, setRecentOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const now = Date.now()
      const [s, i, a, o] = await Promise.all([
        listSuppliers(),
        listSupplierItems(),
        listAliases(),
        listOrdersInRange(now - HISTORY_DAYS * 86_400_000, now + 86_400_000),
      ])
      setSuppliers(s)
      setSupplierItems(i)
      setAliases(a)
      setRecentOrders(o)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const ctx = useMemo<AssessContext | null>(
    () =>
      loading
        ? null
        : { products, suppliers, supplierItems, recentOrders, plainUnits },
    [loading, products, suppliers, supplierItems, recentOrders, plainUnits],
  )

  return { ctx, aliases, suppliers, supplierItems, recentOrders, loading, error, reload }
}
