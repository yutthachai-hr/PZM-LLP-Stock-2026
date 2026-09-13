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
import { fmtMoney } from '../lib/format'
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

interface Row {
  supplier: Supplier
  /** Null on the placeholder row a supplier with nothing linked gets. */
  product: Product | null
  /** The price row for this pair, when one has been kept. */
  item: SupplierItem | null
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

  // A supplier with no products still gets one row, so it is visible and can be given some.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const s of suppliers) {
      const mine = products
        .filter((p) => p.supplierId === s.id)
        .sort((a, b) => a.name.localeCompare(b.name))
      if (mine.length === 0) {
        out.push({ supplier: s, product: null, item: null })
        continue
      }
      for (const p of mine) {
        out.push({ supplier: s, product: p, item: priceOf.get(`${s.id}/${p.id}`) ?? null })
      }
    }
    const q = search.trim().toLowerCase()
    if (!q) return out
    return out.filter(
      (r) =>
        r.supplier.name.toLowerCase().includes(q) ||
        (r.product?.name ?? '').toLowerCase().includes(q) ||
        (r.product?.sku ?? '').toLowerCase().includes(q) ||
        r.supplier.email.toLowerCase().includes(q),
    )
  }, [suppliers, products, priceOf, search])

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
            <div className="truncate font-medium text-ink">{r.supplier.name}</div>
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
          r.product ? (
            <div className="min-w-0">
              <div className="truncate text-ink">{r.product.name}</div>
              <div className="flex gap-2 text-xs text-ink-faint">
                <span className="doc-no">{r.product.sku}</span>
                {r.item?.buyingPrice !== undefined && (
                  <span className="num">
                    ฿ {fmtMoney(r.item.buyingPrice)} {/* ฿ is a currency symbol — i18n-key */}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <span className="text-xs text-ink-faint">{t('ยังไม่ได้ผูกสินค้า')}</span>
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
            <div className="flex justify-end gap-1">
              <Button variant="ghost" onClick={() => setAddingTo(r.supplier)}>
                {t('เพิ่มสินค้า')}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(r.supplier)}>
                {t('แก้ไข')}
              </Button>
              {r.product ? (
                <button
                  onClick={() => unlink(r.product!)}
                  className="rounded px-2 text-xs font-medium text-danger hover:bg-danger-soft"
                >
                  {t('ปลดสินค้า')}
                </button>
              ) : (
                <button
                  onClick={() => removeSupplier(r.supplier)}
                  className="rounded px-2 text-xs font-medium text-danger hover:bg-danger-soft"
                >
                  {t('ลบ')}
                </button>
              )}
            </div>
          ) : null,
      },
    ],
    // unlink/removeSupplier close over state that changes with every load; the table is
    // cheap to rebuild and this keeps the handlers pointing at current data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, isAdmin, items, suppliers, products],
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
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <Input
            placeholder={t('ค้นหาผู้ขาย หรือสินค้า…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:max-w-xs"
          />
          <span className="ml-auto text-xs text-ink-faint">
            {t('{s} ราย · {i} รายการสินค้า', { s: suppliers.length, i: linkedCount })}
          </span>
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => (r.product ? `${r.supplier.id}/${r.product.id}` : `supplier-${r.supplier.id}`)}
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
  const { products } = useData()
  const toast = useToast()
  const [form, setForm] = useState<SupplierInput>({
    name: supplier?.name ?? '',
    contactNumber: supplier?.contactNumber ?? '',
    email: supplier?.email ?? '',
    type: supplier?.type ?? 'takingReturn',
    note: supplier?.note ?? '',
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
        <Field label={t('หมายเหตุ')}>
          <Textarea
            rows={2}
            value={form.note ?? ''}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
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
      const item = await linkProduct(supplier.id, productId, buyingPrice, items)
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
