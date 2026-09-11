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
import { fmtMoney } from '../lib/format'
import {
  addSupplierItem,
  createSupplier,
  deleteSupplier,
  listSupplierItems,
  listSuppliers,
  removeSupplierItem,
  updateSupplier,
  type SupplierInput,
} from '../services/suppliers'
import type { Supplier, SupplierItem, SupplierType } from '../types'

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
 * Product names come from DataContext, which already holds the catalogue. Nothing here
 * reads `products`.
 */

interface Row {
  item: SupplierItem | null
  supplier: Supplier
  productName: string
  productSku: string
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

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  // A supplier with no products still gets one row, so it is visible and can be given some.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const s of suppliers) {
      const mine = items.filter((i) => i.supplierId === s.id)
      if (mine.length === 0) {
        out.push({ item: null, supplier: s, productName: '', productSku: '' })
        continue
      }
      for (const item of mine) {
        const p = productById.get(item.productId)
        out.push({
          item,
          supplier: s,
          productName: p?.name ?? t('(สินค้าถูกลบไปแล้ว)'),
          productSku: p?.sku ?? '',
        })
      }
    }
    const q = search.trim().toLowerCase()
    if (!q) return out
    return out.filter(
      (r) =>
        r.supplier.name.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        r.productSku.toLowerCase().includes(q) ||
        r.supplier.email.toLowerCase().includes(q),
    )
  }, [suppliers, items, productById, search, t])

  async function removeSupplier(s: Supplier) {
    const n = items.filter((i) => i.supplierId === s.id).length
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
      await deleteSupplier(s.id)
      toast.success(t('ลบแล้ว'))
      await load()
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  async function unlink(item: SupplierItem) {
    try {
      await removeSupplierItem(item.id)
      // Drop it locally rather than re-reading both collections for one deletion.
      setItems((cur) => cur.filter((i) => i.id !== item.id))
      toast.success(t('ลบแล้ว'))
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
          r.item ? (
            <div className="min-w-0">
              <div className="truncate text-ink">{r.productName}</div>
              {r.item.buyingPrice !== undefined && (
                <div className="num text-xs text-ink-faint">
                  ฿ {fmtMoney(r.item.buyingPrice)} {/* ฿ is a currency symbol — i18n-key */}
                </div>
              )}
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
              {r.item ? (
                <button
                  onClick={() => unlink(r.item!)}
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
    [t, isAdmin, items, suppliers],
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
            <Button onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} />
              {t('เพิ่มผู้ขาย')}
            </Button>
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
            {t('{s} ราย · {i} รายการสินค้า', { s: suppliers.length, i: items.length })}
          </span>
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.item?.id ?? `supplier-${r.supplier.id}`}
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

      {addingTo && (
        <AddProductModal
          supplier={addingTo}
          onClose={() => setAddingTo(null)}
          onAdded={(item) => setItems((cur) => [...cur, item])}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- editors

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
      if (supplier) await updateSupplier(supplier.id, form)
      else await createSupplier(form)
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

function AddProductModal({
  supplier,
  onClose,
  onAdded,
}: {
  supplier: Supplier
  onClose: () => void
  onAdded: (item: SupplierItem) => void
}) {
  const t = useT()
  const toast = useToast()
  const { products } = useData()
  const [productId, setProductId] = useState('')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)

  const sorted = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  )

  async function save() {
    setBusy(true)
    try {
      const buyingPrice = price.trim() === '' ? undefined : Number(price)
      const id = await addSupplierItem(supplier.id, productId, buyingPrice)
      const now = Date.now()
      // Push the new row into local state instead of re-reading both collections.
      onAdded({
        id,
        supplierId: supplier.id,
        productId,
        ...(buyingPrice === undefined ? {} : { buyingPrice }),
        active: true,
        createdAt: now,
        updatedAt: now,
      })
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
            {sorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
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
