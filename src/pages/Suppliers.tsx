import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useConfirm } from '../components/Confirm'
import { DataTable, type Column } from '../components/DataTable'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  SearchInput,
  Select,
  Spinner,
  Textarea,
} from '../components/ui'
import {
  FilterBar,
  FilterField,
  FramePage,
  ItemCell,
  PageHero,
  SectionCard,
  StatRow,
  StatTile,
  StatusChip,
  WithSidePanel,
  type RowMenuItem,
  type Tone,
} from '../components/frame'
import { SupplierDetail } from './suppliers/SupplierDetail'
import { orderCache } from '../data/orderCache'
import { bkkDayEnd, bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import type { PurchaseOrder } from '../types'
import { useData } from '../data/DataContext'
import { errText } from '../i18n/AppError'
import { useT } from '../i18n/I18nContext'
import {
  applySupplierProposal,
  buildSupplierProposal,
  renameSupplier,
} from '../services/supplierImport'
import { formatThaiDate } from '../lib/format'
import {
  assignSupplierCodes,
  createSupplier,
  deleteSupplier,
  linkProduct,
  listSupplierItems,
  listSuppliers,
  type SupplierInput,
  unlinkProduct,
  updateSupplier,
} from '../services/suppliers'
import type { Product, Supplier, SupplierItem, SupplierLink, SupplierType } from '../types'
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
  const [shown, setShown] = useState<Shown>('active')
  const [returns, setReturns] = useState<Returns>('all')
  const [sort, setSort] = useState<SortKey>('name')
  const [category, setCategory] = useState('')
  const [terms, setTerms] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [issuing, setIssuing] = useState(false)
  const filterCount =
    (shown !== 'active' ? 1 : 0) + (returns !== 'all' ? 1 : 0) + (category ? 1 : 0) + (terms ? 1 : 0) + (search.trim() ? 1 : 0)

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

  // The orders of the last 90 days, through the shared cache the calendar and the orders
  // screen already fill — "last order" on a row, and the detail panel's history.
  useEffect(() => {
    let alive = true
    const now = Date.now()
    orderCache
      .fetchRange(bkkDayStart(now) - 90 * DAY_MS, bkkDayEnd(now))
      .then((rows) => alive && setOrders(rows))
      .catch(() => alive && setOrders([]))
    return () => {
      alive = false
    }
  }, [])

  const ordersOf = useCallback(
    (supplierId: string) => orders.filter((o) => o.supplierId === supplierId).sort((a, b) => b.orderedAt - a.orderedAt),
    [orders],
  )

  // Price rows by supplier+product — the detail panel prints them beside each product.
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
      if (category && (supplier.category ?? '') !== category) continue
      if (terms && (supplier.paymentTerms ?? '') !== terms) continue
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
  }, [suppliers, products, q, shown, returns, sort, category, terms])

  const categories = useMemo(() => [...new Set(suppliers.map((s) => s.category).filter(Boolean) as string[])].sort(), [suppliers])
  const termsList = useMemo(() => [...new Set(suppliers.map((s) => s.paymentTerms).filter(Boolean) as string[])].sort(), [suppliers])
  const selected = suppliers.find((s) => s.id === selectedId) ?? null
  const noCode = suppliers.filter((s) => !s.code).length

  async function issueCodes() {
    setIssuing(true)
    try {
      const r = await assignSupplierCodes()
      toast.success(r.issued === 0 ? t('ผู้ขายทุกรายมีรหัสแล้ว') : t('ออกรหัสให้ {n} ราย ({from} – {to})', { n: r.issued, from: r.from ?? '', to: r.to ?? '' }))
      await load()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setIssuing(false)
    }
  }

  function menuFor(sup: Supplier): RowMenuItem[] {
    const items: RowMenuItem[] = [{ key: 'view', label: t('ดูรายละเอียด'), icon: 'eye', onSelect: () => setSelectedId(sup.id) }]
    if (isAdmin) {
      items.push(
        { key: 'edit', label: t('แก้ไข'), icon: 'pencil', onSelect: () => setEditing(sup) },
        { key: 'add', label: t('เพิ่มสินค้า'), icon: 'plus', onSelect: () => setAddingTo(sup) },
        { key: 'hide', label: sup.active === false ? t('เลิกซ่อนผู้ขายรายนี้') : t('ซ่อนผู้ขายรายนี้'), icon: sup.active === false ? 'eye' : 'eyeOff', onSelect: () => void toggleHidden(sup) },
        { key: 'del', label: t('ลบ'), icon: 'trash', danger: true, onSelect: () => void removeSupplier(sup) },
      )
    }
    return items
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
        className: 'md:max-w-[240px]',
        cell: (r) => (
          <ItemCell
            title={r.supplier.name}
            avatar={r.supplier.name}
            tone={avatarTone(r.supplier.name)}
            sub={
              <>
                <span className="doc-no">{r.supplier.code ?? '—'}</span>
                {r.supplier.contactNumber ? ` · ${r.supplier.contactNumber}` : ''}
                {r.supplier.email ? ` · ${r.supplier.email}` : ''}
              </>
            }
          />
        ),
      },
      {
        key: 'category',
        header: t('หมวดหมู่'),
        cell: (r) =>
          r.supplier.category ? (
            <StatusChip tone="blue" icon={null} size="sm">
              {r.supplier.category}
            </StatusChip>
          ) : (
            <span className="text-ink-faint">—</span>
          ),
      },
      { key: 'terms', header: t('เงื่อนไขชำระเงิน'), className: 'text-ink-soft', cell: (r) => r.supplier.paymentTerms || '—' },
      {
        key: 'lead',
        header: t('ระยะเวลาส่ง'),
        className: 'num whitespace-nowrap text-ink-soft',
        cell: (r) => (r.supplier.leadTimeDays === undefined ? '—' : t('{n} วัน', { n: r.supplier.leadTimeDays })),
      },
      {
        key: 'products',
        header: t('สินค้าที่ผูก'),
        card: 'value',
        align: 'right',
        className: 'num text-ink-soft',
        cell: (r) => r.products.length,
      },
      {
        key: 'last',
        header: t('สั่งซื้อล่าสุด'),
        card: 'hidden',
        className: 'hidden whitespace-nowrap text-ink-soft 2xl:table-cell',
        headerClassName: 'hidden 2xl:table-cell',
        cell: (r) => {
          const last = ordersOf(r.supplier.id)[0]
          if (!last) return <span className="text-ink-faint">—</span>
          return (
            <span className="block">
              <span className="num block text-xs">{formatThaiDate(last.orderedAt)}</span>
              <span className="doc-no block text-xs text-ink-faint">{last.docNo}</span>
            </span>
          )
        },
      },
      {
        key: 'status',
        header: t('สถานะ'),
        cell: (r) =>
          r.supplier.active === false ? (
            <StatusChip tone="slate" size="sm">{t('ไม่ใช้งาน')}</StatusChip>
          ) : (
            <StatusChip tone="green" size="sm">{t('ใช้งานอยู่')}</StatusChip>
          ),
      },
    ],
    // ordersOf and the handlers close over state that changes with every load; the table is
    // cheap to rebuild and this keeps them pointing at current data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, isAdmin, items, suppliers, products, ordersOf],
  )

  if (loading) return <Spinner label={t('กำลังโหลดผู้ขาย...')} />

  const active = suppliers.filter((x) => x.active !== false).length

  return (
    <FramePage>
      <PageHero
        icon="users"
        title={t('ผู้ขาย')}
        subtitle={t('รายชื่อผู้ขาย ข้อมูลติดต่อ เงื่อนไขการชำระเงิน และสินค้าที่ซื้อจากแต่ละราย')}
        actions={
          isAdmin ? (
            <div className="flex flex-wrap gap-2">
              {/* The owner's choice (22 Sep 2026): every supplier gets a code, the older
                  ones in one batch. Safe to press twice — see assignSupplierCodes. */}
              {noCode > 0 && (
                <Button variant="secondary" onClick={() => void issueCodes()} disabled={issuing}>
                  <Icon name="fileSheet" size={16} />
                  {issuing ? t('กำลังออกรหัส...') : t('ออกรหัสผู้ขาย ({n} ราย)', { n: noCode })}
                </Button>
              )}
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

      <StatRow columns={4}>
        <StatTile icon="users" tone="brand" label={t('ผู้ขายทั้งหมด')} value={suppliers.length} unit={t('ราย')} hint={t('ที่โหลดมา')} />
        <StatTile icon="checkCircle" tone="green" label={t('ใช้งานอยู่')} value={active} unit={t('ราย')} onClick={() => setShown('active')} selected={shown === 'active'} />
        <StatTile icon="eyeOff" tone="slate" label={t('ไม่ใช้งาน')} value={suppliers.length - active} unit={t('ราย')} onClick={() => setShown('hidden')} selected={shown === 'hidden'} />
        <StatTile icon="package" tone="purple" label={t('สินค้าที่ผูกกับผู้ขาย')} value={linkedCount} unit={t('รายการ')} hint={t('จากแคตตาล็อกทั้งหมด')} />
      </StatRow>

      <FilterBar
        search={<SearchInput value={search} onChange={setSearch} placeholder={t('ค้นหาผู้ขาย หรือสินค้า…')} />}
        onReset={() => {
          setSearch('')
          setShown('active')
          setReturns('all')
          setCategory('')
          setTerms('')
        }}
        resetDisabled={filterCount === 0}
      >
        <FilterField label={t('หมวดหมู่')}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t('ทั้งหมด')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label={t('สถานะ')}>
          <Select value={shown} onChange={(e) => setShown(e.target.value as Shown)}>
            <option value="active">{t('ที่ใช้งาน')}</option>
            <option value="hidden">{t('ที่ซ่อนไว้')}</option>
            <option value="all">{t('ทั้งหมด')}</option>
          </Select>
        </FilterField>
        <FilterField label={t('เงื่อนไขชำระเงิน')}>
          <Select value={terms} onChange={(e) => setTerms(e.target.value)}>
            <option value="">{t('ทั้งหมด')}</option>
            {termsList.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label={t('รับคืนของ')}>
          <Select value={returns} onChange={(e) => setReturns(e.target.value as Returns)}>
            <option value="all">{t('ทั้งหมด')}</option>
            <option value="takingReturn">{t('รับคืน')}</option>
            <option value="notTakingReturn">{t('ไม่รับคืน')}</option>
          </Select>
        </FilterField>
      </FilterBar>

      <WithSidePanel
        sideLabel={t('รายละเอียดผู้ขาย')}
        side={
          selected ? (
            <SupplierDetail
              supplier={selected}
              products={products.filter((p) => p.supplierId === selected.id).sort((a2, b2) => a2.name.localeCompare(b2.name))}
              orders={ordersOf(selected.id)}
              priceOf={(productId) => priceOf.get(`${selected.id}/${productId}`)}
              onUnlink={isAdmin ? unlink : undefined}
              canEdit={isAdmin}
              onEdit={() => setEditing(selected)}
              onAddProduct={() => setAddingTo(selected)}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <SectionCard icon="users" title={t('รายละเอียดผู้ขาย')}>
              <p className="py-6 text-center text-sm text-ink-faint">{t('เลือกผู้ขายจากรายการเพื่อดูรายละเอียด')}</p>
            </SectionCard>
          )
        }
      >
        <SectionCard
          icon="list"
          title={t('รายชื่อผู้ขาย')}
          count={t('({n} ราย)', { n: rows.length })}
          flush
          actions={
            <label className="flex items-center gap-2 whitespace-nowrap text-sm text-ink-soft">
              {t('เรียงตาม')}
              <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-auto">
                <option value="name">{t('ชื่อ ก–ฮ / A–Z')}</option>
                <option value="products">{t('จำนวนสินค้า มาก→น้อย')}</option>
              </Select>
            </label>
          }
        >
          <div className="pb-2 md:px-5 md:pb-5">
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(r) => r.supplier.id}
              rowClassName={(r) => `${r.supplier.active === false ? 'opacity-60' : ''} ${r.supplier.id === selectedId ? 'bg-brand-soft/60' : ''}`}
              minWidth={820}
              onRowClick={(r) => setSelectedId(r.supplier.id)}
              rowMenu={(r) => menuFor(r.supplier)}
              empty={
                <EmptyState
                  icon="users"
                  title={t('ยังไม่มีผู้ขาย')}
                  hint={isAdmin ? t('กด "เพิ่มผู้ขาย" เพื่อเริ่ม') : t('ผู้ดูแลระบบเป็นผู้เพิ่มรายชื่อผู้ขาย')}
                />
              }
            />
          </div>
        </SectionCard>
      </WithSidePanel>

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

      {importing && <ImportFromCatalogue onClose={() => setImporting(false)} onDone={() => void load()} />}
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
    </FramePage>
  )
}

/** A steady colour per supplier, from its name, for the initials circle. */
const AVATAR_TONES: Tone[] = ['red', 'blue', 'green', 'amber', 'purple']
function avatarTone(name: string): Tone {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
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
    contactName: supplier?.contactName ?? '',
    phone2: supplier?.phone2 ?? '',
    address: supplier?.address ?? '',
    taxId: supplier?.taxId ?? '',
    paymentTerms: supplier?.paymentTerms ?? '',
    category: supplier?.category ?? '',
    links: supplier?.links ?? [],
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
        <Field label={t('ผู้ติดต่อ')}>
          <Input
            value={form.contactName ?? ''}
            onChange={(e) => setForm({ ...form, contactName: e.target.value })}
            placeholder={t('เช่น คุณเอ (ฝ่ายขาย)')}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('เบอร์ติดต่อ')}>
            <Input
              value={form.contactNumber}
              onChange={(e) => setForm({ ...form, contactNumber: e.target.value })}
              inputMode="tel"
            />
          </Field>
          <Field label={t('เบอร์สำรอง')}>
            <Input value={form.phone2 ?? ''} onChange={(e) => setForm({ ...form, phone2: e.target.value })} inputMode="tel" />
          </Field>
        </div>
        <Field label={t('อีเมล')}>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label={t('ที่อยู่')}>
          <Textarea rows={2} value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('หมวดหมู่')} hint={t('กลุ่มของผู้ขายตามที่บริษัทเรียก เช่น ผัก, บรรจุภัณฑ์')}>
            <Input value={form.category ?? ''} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </Field>
          <Field label={t('เลขผู้เสียภาษี')}>
            <Input value={form.taxId ?? ''} onChange={(e) => setForm({ ...form, taxId: e.target.value })} inputMode="numeric" />
          </Field>
        </div>
        <Field label={t('เงื่อนไขชำระเงิน')} hint={t('เช่น เงินสด, เครดิต 30 วัน')}>
          <Input value={form.paymentTerms ?? ''} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
        </Field>
        <LinksEditor links={form.links ?? []} onChange={(links) => setForm({ ...form, links })} />
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

/**
 * The supplier's papers, as links.
 *
 * Nothing is uploaded: Firebase's free plan has no Storage, and the company already keeps
 * these in Drive. So the app keeps the label and the address, and opens them in a new tab.
 */
function LinksEditor({ links, onChange }: { links: SupplierLink[]; onChange: (links: SupplierLink[]) => void }) {
  const t = useT()
  const set = (i: number, patch: Partial<SupplierLink>) => onChange(links.map((l, j) => (i === j ? { ...l, ...patch } : l)))
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">{t('เอกสาร (ลิงก์)')}</span>
      <div className="space-y-2">
        {links.map((l, i) => (
          <div key={i} className="flex gap-2">
            <Input value={l.label} onChange={(e) => set(i, { label: e.target.value })} placeholder={t('ชื่อเอกสาร')} className="w-2/5" />
            <Input value={l.url} onChange={(e) => set(i, { url: e.target.value })} placeholder="https://drive.google.com/…" inputMode="url" />
            <button
              type="button"
              onClick={() => onChange(links.filter((_, j) => j !== i))}
              aria-label={t('ลบลิงก์')}
              className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-danger/80 hover:bg-danger-soft"
            >
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
        {links.length < 20 && (
          <Button variant="secondary" size="sm" onClick={() => onChange([...links, { label: '', url: '' }])}>
            <Icon name="plus" size={16} />
            {t('เพิ่มลิงก์เอกสาร')}
          </Button>
        )}
      </div>
    </div>
  )
}
