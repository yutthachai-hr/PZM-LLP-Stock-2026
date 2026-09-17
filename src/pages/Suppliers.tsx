import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useConfirm } from '../components/Confirm'
import { DataTable, type Column } from '../components/DataTable'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '../components/ui'
import { useData } from '../data/DataContext'
import { errText } from '../i18n/AppError'
import { useT } from '../i18n/I18nContext'
import {
  applySupplierProposal,
  buildSupplierProposal,
  renameSupplier,
} from '../services/supplierImport'
import { fmtMoney, fmtQty } from '../lib/format'
import {
  createSupplier,
  deleteSupplier,
  linkProduct,
  listSupplierItems,
  listSuppliers,
  unlinkProduct,
  updateSupplier,
  type SupplierInput,
} from '../services/suppliers'
import type { Product, Supplier, SupplierItem, SupplierType } from '../types'
import { looseMatch } from '../lib/search'

// Sunday first, matching Date#getDay(). i18n-key
const ORDER_DAY_NAMES = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] // i18n-key

/**
 * Who we buy from.
 *
 * One row per supplier x product, because that is what a supplier list is for: the same
 * company sells us several things at several prices, and the question people arrive with
 * is "who sells us this, and for how much".
 *
 * ## Reads
 *
 * Two one-shot reads when the screen opens — every supplier (~20 documents) and every
 * supplier-product link (~100) — and nothing while it is closed. Neither is subscribed:
 * this app is on Firebase's free plan, the shared tablets sign out after 20 minutes and
 * clear their offline copy, so a global subscription is billed again on nearly every
 * session on every device in every branch, for a screen almost nobody has open.
 *
 * Products come from DataContext, which already holds the catalogue, and the link from a
 * product to its supplier is the product's own `supplierId` — the field the catalogue
 * import fills in and the ordering screen reads. This screen used to list from the
 * supplierItems price rows instead, so after the import wrote 299 links it still showed
 * every supplier as "ยังไม่ได้ผูกสินค้า", and its own "เพิ่มสินค้า" wrote a row Orders never saw.
 * The price rows are now only what they hold that the product cannot: the price.
 */

/**
 * One row per supplier. The products sit inside the row, folded, and open on a click —
 * the owner's words were "หนึ่งผู้ขาย ส่วนรายการสินค้าจะมีกี่รายการก็ได้": a supplier is a
 * row, not four rows that happen to share a name. With 86 suppliers and 299 products the
 * old one-row-per-pair table was 300 rows to scroll for a list of 86 names.
 */
type Shown = 'active' | 'hidden' | 'all'
type Returns = 'all' | 'takingReturn' | 'notTakingReturn'
type SortKey = 'name' | 'products'

interface Row {
  supplier: Supplier
  /** Everything linked to this supplier, by name. */
  products: Product[]
  /** Products the search matched inside this supplier, or all of them when not searching. */
  shown: Product[]
}

export function SuppliersPage() {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const { products } = useData()
  const isAdmin = user?.role === 'admin'

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [items, setItems] = useState<SupplierItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [creating, setCreating] = useState(false)
  const [addingTo, setAddingTo] = useState<Supplier | null>(null)
  const [search, setSearch] = useState('')
  const [importing, setImporting] = useState(false)
  // The same shape as the products screen: search stays out, the rest folds behind a
  // button that says how many are on. Hidden suppliers are out of the default view, and
  // "ที่ซ่อนไว้" is where they are found again.
  const [showFilters, setShowFilters] = useState(false)
  const [shown, setShown] = useState<Shown>('active')
  const [returns, setReturns] = useState<Returns>('all')
  const [sort, setSort] = useState<SortKey>('name')
  const filterCount = (shown !== 'active' ? 1 : 0) + (returns !== 'all' ? 1 : 0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, i] = await Promise.all([listSuppliers(), listSupplierItems()])
      setSuppliers(s)
      setItems(i)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setLoading(false)
    }
  }, [toast, t])

  useEffect(() => {
    void load()
  }, [load])

  const priceOf = useMemo(() => {
    const m = new Map<string, SupplierItem>()
    for (const i of items) m.set(`${i.supplierId}/${i.productId}`, i)
    return m
  }, [items])

  const q = search.trim().toLowerCase()

  // Every supplier gets a row, products or not, so an empty one is visible and can be
  // given some. A search keeps a row when the supplier matches, or when one of its
  // products does — and in the second case shows only the products that matched, so
  // searching for a product lands on it rather than on a folded list of forty.
  const rows = useMemo<Row[]>(() => {
    const byName = (a: Product, b: Product) => a.name.localeCompare(b.name)
    const out: Row[] = []
    for (const supplier of suppliers) {
      const hidden = supplier.active === false
      if (shown === 'active' && hidden) continue
      if (shown === 'hidden' && !hidden) continue
      if (returns !== 'all' && supplier.type !== returns) continue
      const mine = products.filter((p) => p.supplierId === supplier.id).sort(byName)
      if (!q) {
        out.push({ supplier, products: mine, shown: mine })
        continue
      }
      // "SIAM FOOD" and "SIAMFOOD" are the same supplier to the person typing.
      const supplierHit = looseMatch([supplier.name, supplier.email], q)
      const hits = mine.filter((p) => looseMatch([p.name, p.sku], q))
      if (supplierHit) out.push({ supplier, products: mine, shown: mine })
      else if (hits.length) out.push({ supplier, products: mine, shown: hits })
    }
    if (sort === 'products') {
      out.sort(
        (a, b) => b.products.length - a.products.length || a.supplier.name.localeCompare(b.supplier.name),
      )
    }
    return out
  }, [suppliers, products, q, shown, returns, sort])

  // Which suppliers are unfolded. A search unfolds every row it kept, because the row was
  // kept for what is inside it.
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const isOpen = (id: string) => !!q || open.has(id)
  function toggle(id: string) {
    setOpen((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const linkedCount = useMemo(() => products.filter((p) => !!p.supplierId).length, [products])

  async function removeSupplier(s: Supplier) {
    const n = products.filter((p) => p.supplierId === s.id).length
    const ok = await confirm({
      title: t('ลบผู้ขาย'),
      message: t('ลบ "{name}" ? รายการสินค้าที่ผูกไว้ {n} รายการจะถูกลบด้วย', {
        name: s.name,
        n,
      }),
      danger: true,
      confirmText: t('ลบ'),
    })
    if (!ok) return
    try {
      await deleteSupplier(s.id, products)
      toast.success(t('ลบแล้ว'))
      await load()
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  // Hide rather than delete, as with products. A supplier that stops supplying keeps its
  // name on every order it filled; hiding takes it off the ordering screen and the product
  // editor, and it is one click from coming back.
  async function toggleHidden(sup: Supplier) {
    const hide = sup.active !== false
    try {
      await updateSupplier(sup.id, { active: !hide })
      setSuppliers((cur) => cur.map((x) => (x.id === sup.id ? { ...x, active: !hide } : x)))
      toast.success(hide ? t('ซ่อนแล้ว — ดูได้ที่ตัวกรอง "ที่ซ่อนไว้"') : t('เลิกซ่อนแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  async function unlink(product: Product) {
    try {
      await unlinkProduct(product.id, items)
      // The product itself comes back through the products subscription; only the price
      // row is ours to drop, and dropping it locally beats re-reading the collection.
      setItems((cur) => cur.filter((i) => i.productId !== product.id))
      toast.success(t('ปลดสินค้าแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        key: 'supplier',
        header: t('ผู้ขาย'),
        primary: true,
        cell: (r) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-ink">{r.supplier.name}</span>
              {r.supplier.active === false && <Badge color="amber">{t('ซ่อนไว้')}</Badge>}
            </div>
            {r.supplier.note && (
              <div className="truncate text-xs text-ink-faint">{r.supplier.note}</div>
            )}
          </div>
        ),
      },
      {
        key: 'product',
        header: t('สินค้า'),
        cell: (r) =>
          r.products.length === 0 ? (
            <span className="text-xs text-ink-faint">{t('ยังไม่ได้ผูกสินค้า')}</span>
          ) : (
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => toggle(r.supplier.id)}
                aria-expanded={isOpen(r.supplier.id)}
                className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink hover:bg-sunken"
              >
                <Icon
                  name="chevronDown"
                  size={14}
                  className={`transition-transform ${isOpen(r.supplier.id) ? 'rotate-180' : ''}`}
                />
                {q && r.shown.length !== r.products.length
                  ? t('{n} รายการ (ตรง {m})', { n: r.products.length, m: r.shown.length })
                  : t('{n} รายการ', { n: r.products.length })}
              </button>
              {isOpen(r.supplier.id) && (
                <ul className="mt-1 divide-y divide-line rounded-lg border border-line bg-sunken/60">
                  {r.shown.map((p) => {
                    const link = priceOf.get(`${r.supplier.id}/${p.id}`)
                    const price = link?.buyingPrice
                    return (
                      <li key={p.id} className="flex items-center gap-3 px-3 py-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-ink">{p.name}</div>
                          <div className="flex gap-2 text-xs text-ink-faint">
                            <span className="doc-no">{p.sku}</span>
                            <span>{p.unitType}</span>
                            {price !== undefined && (
                              <span className="num">
                                ฿ {fmtMoney(price)} {/* ฿ is a currency symbol — i18n-key */}
                              </span>
                            )}
                            {link?.minOrderQty !== undefined && (
                              <span className="num">
                                {t('ขั้นต่ำ {n}', { n: fmtQty(link.minOrderQty) })}
                              </span>
                            )}
                          </div>
                        </div>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => unlink(p)}
                            className="shrink-0 rounded px-2 py-1 text-xs font-medium text-danger hover:bg-danger-soft"
                          >
                            {t('ปลด')}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ),
      },
      {
        key: 'contact',
        header: t('เบอร์ติดต่อ'),
        className: 'text-ink-soft',
        cell: (r) => r.supplier.contactNumber || '—',
      },
      {
        key: 'email',
        header: t('อีเมล'),
        className: 'text-ink-soft',
        cell: (r) => r.supplier.email || '—',
      },
      {
        key: 'type',
        header: t('รับคืนของ'),
        cell: (r) =>
          r.supplier.type === 'takingReturn' ? (
            <Badge color="green">{t('รับคืน')}</Badge>
          ) : (
            <Badge color="red">{t('ไม่รับคืน')}</Badge>
          ),
      },
      {
        key: 'onTheWay',
        header: t('กำลังจะเข้า'),
        align: 'right',
        className: 'text-ink-faint',
        // A count of open purchase orders. There is no PO module, so there is no number to
        // show — and a zero would read as "nothing is coming" rather than "we do not know".
        cell: () => '—',
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tableOnly: true,
        cell: (r) =>
          isAdmin ? (
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => void toggleHidden(r.supplier)}
                title={r.supplier.active === false ? t('เลิกซ่อนผู้ขายรายนี้') : t('ซ่อนผู้ขายรายนี้')}
                aria-label={r.supplier.active === false ? t('เลิกซ่อนผู้ขายรายนี้') : t('ซ่อนผู้ขายรายนี้')}
                className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors duration-150 hover:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40 ${
                  r.supplier.active === false ? 'text-warn' : 'text-ink-faint hover:text-ink'
                }`}
              >
                <Icon name={r.supplier.active === false ? 'eyeOff' : 'eye'} size={18} />
              </button>
              <Button variant="ghost" className="whitespace-nowrap" onClick={() => setAddingTo(r.supplier)}>
                {t('เพิ่มสินค้า')}
              </Button>
              <Button variant="ghost" className="whitespace-nowrap" onClick={() => setEditing(r.supplier)}>
                {t('แก้ไข')}
              </Button>
              <button
                onClick={() => removeSupplier(r.supplier)}
                className="rounded px-2 text-xs font-medium text-danger hover:bg-danger-soft"
              >
                {t('ลบ')}
              </button>
            </div>
          ) : null,
      },
    ],
    // unlink/removeSupplier close over state that changes with every load; the table is
    // cheap to rebuild and this keeps the handlers pointing at current data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, isAdmin, items, suppliers, products, open, q, priceOf],
  )

  if (loading) return <Spinner label={t('กำลังโหลดผู้ขาย...')} />

  return (
    <div className="space-y-4">
      <PageHeader
        icon="users"
        title={t('ผู้ขาย')}
        subtitle={t('รายชื่อผู้ขายและสินค้าที่ซื้อจากแต่ละราย')}
        actions={
          isAdmin ? (
            <div className="flex gap-2">
              {/* The catalogue already names its suppliers, in brackets. This reads them out
                  and shows what it found; nothing is written until it is accepted. */}
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <Icon name="download" size={16} />
                {t('นำเข้าจากชื่อสินค้า')}
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Icon name="plus" size={16} />
                {t('เพิ่มผู้ขาย')}
              </Button>
            </div>
          ) : undefined
        }
      />

      <Card className="overflow-hidden">
        <div className="border-b border-line p-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder={t('ค้นหาผู้ขาย หรือสินค้า…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:max-w-xs"
            />
            <Button
              variant={showFilters || filterCount > 0 ? 'secondary' : 'ghost'}
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              aria-controls="supplier-filters"
            >
              <Icon name="adjust" size={16} />
              {filterCount > 0 ? t('ตัวกรอง ({n})', { n: filterCount }) : t('ตัวกรอง')}
              <Icon
                name="chevronDown"
                size={14}
                className={showFilters ? 'rotate-180 transition-transform' : 'transition-transform'}
              />
            </Button>
            <span className="ml-auto text-xs text-ink-faint">
              {t('{s} ราย · {i} รายการสินค้า', { s: rows.length, i: linkedCount })}
            </span>
          </div>
          <div
            id="supplier-filters"
            className={
              showFilters ? 'mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3' : 'hidden'
            }
          >
            <Field label={t('สถานะ')}>
              <Select value={shown} onChange={(e) => setShown(e.target.value as Shown)} className="w-[150px]">
                <option value="active">{t('ที่ใช้งาน')}</option>
                <option value="hidden">{t('ที่ซ่อนไว้')}</option>
                <option value="all">{t('ทั้งหมด')}</option>
              </Select>
            </Field>
            <Field label={t('รับคืนของ')}>
              <Select value={returns} onChange={(e) => setReturns(e.target.value as Returns)} className="w-[150px]">
                <option value="all">{t('ทั้งหมด')}</option>
                <option value="takingReturn">{t('รับคืน')}</option>
                <option value="notTakingReturn">{t('ไม่รับคืน')}</option>
              </Select>
            </Field>
            <Field label={t('เรียงตาม')}>
              <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-[190px]">
                <option value="name">{t('ชื่อ ก–ฮ / A–Z')}</option>
                <option value="products">{t('จำนวนสินค้า มาก→น้อย')}</option>
              </Select>
            </Field>
            {filterCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShown('active')
                  setReturns('all')
                }}
                className="min-h-11 text-sm font-medium text-brand hover:underline"
              >
                {t('ล้างตัวกรอง ({n})', { n: filterCount })}
              </button>
            )}
          </div>
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.supplier.id}
          rowClassName={(r) => (r.supplier.active === false ? 'opacity-60' : '')}
          minWidth={900}
          maxHeight="calc(100vh - 300px)"
          empty={
            <EmptyState
              icon="users"
              title={t('ยังไม่มีผู้ขาย')}
              hint={
                isAdmin
                  ? t('กด "เพิ่มผู้ขาย" เพื่อเริ่ม')
                  : t('ผู้ดูแลระบบเป็นผู้เพิ่มรายชื่อผู้ขาย')
              }
            />
          }
          cardActions={
            isAdmin
              ? (r) => (
                  <>
                    <Button variant="secondary" onClick={() => void toggleHidden(r.supplier)}>
                      <Icon name={r.supplier.active === false ? 'eyeOff' : 'eye'} size={16} />
                      {r.supplier.active === false ? t('เลิกซ่อน') : t('ซ่อน')}
                    </Button>
                    <Button variant="secondary" onClick={() => setAddingTo(r.supplier)}>
                      {t('เพิ่มสินค้า')}
                    </Button>
                    <Button variant="secondary" onClick={() => setEditing(r.supplier)}>
                      {t('แก้ไข')}
                    </Button>
                  </>
                )
              : undefined
          }
        />
      </Card>

      {(creating || editing) && (
        <SupplierEditor
          supplier={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={load}
        />
      )}

      {importing && (
        <ImportFromCatalogue onClose={() => setImporting(false)} onDone={() => void load()} />
      )}
      {addingTo && (
        <AddProductModal
          supplier={addingTo}
          suppliers={suppliers}
          items={items}
          onClose={() => setAddingTo(null)}
          onLinked={(productId, item) =>
            setItems((cur) => [...cur.filter((i) => i.productId !== productId), ...(item ? [item] : [])])
          }
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- editors

/**
 * What reading the catalogue's brackets would produce, before any of it is written.
 *
 * The proposal is shown rather than applied because the brackets are a habit and not a
 * field: among 126 of them are one company spelled three ways, a branch, and a shop that
 * reads as a measurement. Undoing a bad import would mean unpicking 454 products, so the
 * screen that would cause it is the screen that shows what it will do.
 */
function ImportFromCatalogue({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT()
  const toast = useToast()
  const { products } = useData()
  const [busy, setBusy] = useState(false)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())

  const proposal = useMemo(() => buildSupplierProposal(products), [products])
  const chosen = proposal.suppliers.filter((s) => !skipped.has(s.name))
  const mergedCount = proposal.suppliers.filter((s) => s.merged).length

  function toggle(name: string) {
    setSkipped((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function apply() {
    setBusy(true)
    try {
      const done = await applySupplierProposal(chosen)
      toast.success(
        t('นำเข้าแล้ว: ผู้ขาย {suppliers} ราย, ผูกสินค้า {products} รายการ', {
          suppliers: done.suppliers,
          products: done.products,
        }),
      )
      onDone()
      onClose()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('นำเข้าผู้ขายจากชื่อสินค้า')} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={t('ผู้ขายที่พบ')} value={proposal.suppliers.length} />
          <Stat label={t('สินค้าที่จะผูก')} value={proposal.linked} />
          <Stat label={t('ยังไม่มีผู้ขาย')} value={proposal.withoutSupplier.length} />
        </div>
        <p className="text-xs text-ink-soft">
          {t('ชื่อในวงเล็บของสินค้าถูกอ่านเป็นผู้ขาย — ขนาดบรรจุถูกข้าม และการสะกดที่ต่างกันถูกรวมให้แล้ว {merged} ราย ตรวจแล้วติ๊กออกรายที่ไม่ต้องการ', { merged: mergedCount })}
        </p>

        <div className="max-h-80 overflow-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-sunken text-xs text-ink-soft">
              <tr>
                <th className="p-2 text-left font-medium">{t('ผู้ขาย')}</th>
                <th className="p-2 text-left font-medium">{t('สะกดในแคตตาล็อก')}</th>
                <th className="p-2 text-right font-medium">{t('สินค้า')}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {proposal.suppliers.map((s) => {
                const off = skipped.has(s.name)
                return (
                  <tr key={s.name} className={off ? 'opacity-40' : ''}>
                    <td className="p-2">
                      <span className="font-medium text-ink">{s.name}</span>
                      {s.merged && (
                        <span className="ml-2 align-middle">
                          <Badge color="amber">{t('รวมสะกด')}</Badge>
                        </span>
                      )}
                      {s.note && <div className="text-xs text-ink-faint">{t(s.note)}</div>}
                    </td>
                    <td className="p-2 text-xs text-ink-soft">{s.spellings.join(', ')}</td>
                    <td className="num p-2 text-right">{s.productIds.length}</td>
                    <td className="p-2 text-right">
                      <button
                        onClick={() => toggle(s.name)}
                        className="rounded px-2 text-xs font-medium text-ink-soft hover:bg-sunken"
                      >
                        {off ? t('เอากลับ') : t('ไม่เอา')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {proposal.withoutSupplier.length > 0 && (
          <details className="rounded-lg border border-line bg-sunken px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-ink-soft">
              {t('สินค้าที่ชื่อไม่ได้บอกผู้ขาย ({count} รายการ) — ใส่เองได้ที่หน้าสินค้า', {
                count: proposal.withoutSupplier.length,
              })}
            </summary>
            <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">
              {proposal.withoutSupplier.map((p) => (
                <li key={p.id}>{p.name}</li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('ยกเลิก')}
          </Button>
          <Button onClick={() => void apply()} disabled={busy || chosen.length === 0}>
            {busy
              ? t('กำลังบันทึก...')
              : t('ยืนยันนำเข้า {count} ราย', { count: chosen.length })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-sunken px-3 py-2">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="num text-lg font-semibold text-ink">{value}</div>
    </div>
  )
}

function SupplierEditor({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const t = useT()
  // The catalogue, already in memory: renaming needs it to find the names to rewrite.
  const { products, locations } = useData()
  const toast = useToast()
  const [form, setForm] = useState<SupplierInput>({
    name: supplier?.name ?? '',
    contactNumber: supplier?.contactNumber ?? '',
    email: supplier?.email ?? '',
    type: supplier?.type ?? 'takingReturn',
    note: supplier?.note ?? '',
    defaultLocationId: supplier?.defaultLocationId,
    leadTimeDays: supplier?.leadTimeDays,
    orderDays: supplier?.orderDays ?? [],
    cutoffTime: supplier?.cutoffTime ?? '',
  })
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      if (supplier) {
        // Renaming is its own operation: it rewrites the bracket in every product name that
        // carries this supplier, which is what the owner asked for and is not something an
        // ordinary field update should do behind the scenes.
        const renamedTo = form.name.trim()
        if (renamedTo && renamedTo !== supplier.name) {
          const touched = await renameSupplier(supplier.id, renamedTo, products)
          if (touched > 0) {
            toast.success(t('เปลี่ยนชื่อในสินค้า {count} รายการแล้ว', { count: touched }))
          }
        }
        await updateSupplier(supplier.id, { ...form, name: renamedTo })
      } else await createSupplier(form)
      toast.success(t('บันทึกแล้ว'))
      await onSaved()
      onClose()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={supplier ? t('แก้ไขผู้ขาย') : t('เพิ่มผู้ขาย')}
    >
      <div className="space-y-3">
        <Field label={t('ชื่อผู้ขาย')} required>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('เช่น SIMUMMUANG')}
          />
        </Field>
        <Field label={t('เบอร์ติดต่อ')}>
          <Input
            value={form.contactNumber}
            onChange={(e) => setForm({ ...form, contactNumber: e.target.value })}
            inputMode="tel"
          />
        </Field>
        <Field label={t('อีเมล')}>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label={t('รับคืนของ')}>
          <Select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as SupplierType })}
          >
            <option value="takingReturn">{t('รับคืน')}</option>
            <option value="notTakingReturn">{t('ไม่รับคืน')}</option>
          </Select>
        </Field>
        {/* Defaults the automatic order offers, not rules it enforces: where this supplier
            usually delivers, and how long they take. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('คลังปลายทางปกติ')}>
            <Select
              value={form.defaultLocationId ?? ''}
              onChange={(e) =>
                setForm({ ...form, defaultLocationId: e.target.value || undefined })
              }
            >
              <option value="">{t('— ไม่ระบุ —')}</option>
              {locations
                .filter((l) => l.active !== false || l.id === form.defaultLocationId)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('ระยะเวลาส่ง (วัน)')}>
            <Input
              type="number"
              min={0}
              max={365}
              step={1}
              value={form.leadTimeDays ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  leadTimeDays: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
              placeholder={t('เช่น 2')}
            />
          </Field>
        </div>
        {/* Their order rhythm. The calendar puts a cut-off on each order day at this time;
            nothing refuses an order placed after it. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-ink">{t('วันที่รับออเดอร์')}</legend>
            <div className="flex flex-wrap gap-1">
              {ORDER_DAY_NAMES.map((name, day) => {
                const on = (form.orderDays ?? []).includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setForm({
                        ...form,
                        orderDays: on ? (form.orderDays ?? []).filter((d) => d !== day) : [...(form.orderDays ?? []), day].sort(),
                      })
                    }
                    className={`min-h-11 min-w-11 rounded-lg px-2 text-sm font-medium ${
                      on ? 'bg-brand text-white' : 'bg-sunken text-ink-soft hover:bg-line'
                    }`}
                  >
                    {t(name)}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-ink-soft">{t('ไม่เลือก = สั่งได้ทุกวัน')}</p>
          </fieldset>
          <Field label={t('เวลาตัดรอบสั่ง')} hint={t('ปฏิทินจะแสดง "ตัดรอบสั่ง" ในวันที่เลือก')}>
            <Input type="time" value={form.cutoffTime ?? ''} onChange={(e) => setForm({ ...form, cutoffTime: e.target.value })} />
          </Field>
        </div>
        <Field label={t('หมายเหตุการสั่งซื้อ')}>
          <Textarea
            rows={2}
            value={form.note ?? ''}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder={t('เช่น สั่งก่อน 10 โมง ส่งวันถัดไป')}
          />
        </Field>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('ยกเลิก')}
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? t('กำลังบันทึก...') : t('บันทึก')}
        </Button>
      </div>
    </Modal>
  )
}

/**
 * Put one product under a supplier by hand.
 *
 * The list is in two groups. First the products nobody supplies yet — after the catalogue
 * import those are the ones whose name carried no bracket, which the owner said they
 * would fill in themselves, and this is where. Then everything already placed, labelled
 * with where it is, so moving one is a choice and not an accident.
 */
function AddProductModal({
  supplier,
  suppliers,
  items,
  onClose,
  onLinked,
}: {
  supplier: Supplier
  suppliers: readonly Supplier[]
  items: readonly SupplierItem[]
  onClose: () => void
  onLinked: (productId: string, item: SupplierItem | null) => void
}) {
  const t = useT()
  const toast = useToast()
  const { products } = useData()
  const [productId, setProductId] = useState('')
  const [price, setPrice] = useState('')
  const [moq, setMoq] = useState('')
  const [busy, setBusy] = useState(false)

  const { free, placed } = useMemo(() => {
    const byName = (a: Product, b: Product) => a.name.localeCompare(b.name)
    const active = products.filter((p) => p.active !== false)
    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]))
    return {
      free: active.filter((p) => !p.supplierId).sort(byName),
      placed: active
        .filter((p) => !!p.supplierId && p.supplierId !== supplier.id)
        .sort(byName)
        .map((p) => ({ p, at: supplierName.get(p.supplierId!) ?? t('(ผู้ขายถูกลบไปแล้ว)') })),
    }
  }, [products, suppliers, supplier.id, t])

  async function save() {
    setBusy(true)
    try {
      const buyingPrice = price.trim() === '' ? undefined : Number(price)
      const minOrderQty = moq.trim() === '' ? undefined : Number(moq)
      const item = await linkProduct(supplier.id, productId, buyingPrice, items, minOrderQty)
      onLinked(productId, item)
      toast.success(t('บันทึกแล้ว'))
      onClose()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('เพิ่มสินค้าให้ {name}', { name: supplier.name })}
    >
      <div className="space-y-3">
        <Field label={t('สินค้า')} required>
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">{t('— เลือกสินค้า —')}</option>
            <optgroup label={t('ยังไม่มีผู้ขาย ({n})', { n: free.length })}>
              {free.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            <optgroup label={t('อยู่กับผู้ขายรายอื่น — เลือกแล้วจะย้ายมา ({n})', { n: placed.length })}>
              {placed.map(({ p, at }) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {at}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
        <Field label={t('ราคาซื้อ/หน่วย (ไม่บังคับ)')}>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label={t('ขั้นต่ำในการสั่ง (ไม่บังคับ)')}>
          <Input
            type="number"
            min={0}
            step="any"
            value={moq}
            onChange={(e) => setMoq(e.target.value)}
            placeholder={t('เช่น 5 — เตือนเมื่อสั่งน้อยกว่านี้')}
          />
        </Field>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('ยกเลิก')}
        </Button>
        <Button onClick={save} disabled={busy || !productId}>
          {busy ? t('กำลังบันทึก...') : t('บันทึก')}
        </Button>
      </div>
    </Modal>
  )
}
