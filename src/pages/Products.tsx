import { useEffect, useMemo, useRef, useState } from 'react'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
} from '../components/ui'
import { ProductThumb, invalidateThumb } from '../components/ProductThumb'
import {
  createProduct,
  updateProduct,
  deleteProduct,
  setProductImage,
  removeProductImage,
  getProductImage,
  type ProductInput,
} from '../services/products'
import { catalogSize, resetCatalog, seedInitialData } from '../services/seed'
import { setStockCount } from '../services/stock'
import { compressImage } from '../lib/image'
import { fmtQty } from '../lib/format'
import type { Product } from '../types'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'

type SearchIn = 'all' | 'name' | 'sku'
type StockStatus = 'all' | 'low' | 'out' | 'in'
type SortKey = 'name-asc' | 'name-desc' | 'sku-asc' | 'sku-desc' | 'qty-desc' | 'qty-asc'

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name-asc', label: 'ชื่อ ก→ฮ / A→Z' }, // i18n-key
  { value: 'name-desc', label: 'ชื่อ ฮ→ก / Z→A' }, // i18n-key
  { value: 'sku-asc', label: 'รหัสสินค้า น้อย→มาก' }, // i18n-key
  { value: 'sku-desc', label: 'รหัสสินค้า มาก→น้อย' }, // i18n-key
  { value: 'qty-desc', label: 'คงเหลือ มาก→น้อย' }, // i18n-key
  { value: 'qty-asc', label: 'คงเหลือ น้อย→มาก' }, // i18n-key
]

export function ProductsPage() {
  const t = useT()
  const { products, locations, qtyAt, loading } = useData()
  const { user } = useAuth()
  const { brand } = useBrand()
  const toast = useToast()
  const confirm = useConfirm()
  const isAdmin = user?.role === 'admin'
  const catalogCount = brand ? catalogSize(brand) : 0

  const [search, setSearch] = useState('')
  const [searchIn, setSearchIn] = useState<SearchIn>('all')
  const [cat, setCat] = useState('')
  const [status, setStatus] = useState<StockStatus>('all')
  const [locId, setLocId] = useState('')
  const [sort, setSort] = useState<SortKey>('name-asc')
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [resetting, setResetting] = useState(false)

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category))].sort(),
    [products],
  )

  // Quantity the list works with: one location when the location filter is set, otherwise
  // every location added up. Both the "คงเหลือ" column and the qty sorts use this.
  const shownQty = useMemo(() => {
    const active = locId ? locations.filter((l) => l.id === locId) : locations
    return (productId: string) => active.reduce((sum, l) => sum + qtyAt(l.id, productId), 0)
  }, [locations, locId, qtyAt])

  const filterCount =
    (search.trim() ? 1 : 0) + (cat ? 1 : 0) + (status !== 'all' ? 1 : 0) + (locId ? 1 : 0)

  function clearFilters() {
    setSearch('')
    setSearchIn('all')
    setCat('')
    setStatus('all')
    setLocId('')
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = (p: Product) => {
      if (!q) return true
      if (searchIn === 'name') return p.name.toLowerCase().includes(q)
      if (searchIn === 'sku') return p.sku.toLowerCase().includes(q)
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      )
    }
    const inStatus = (p: Product) => {
      if (status === 'all') return true
      const qty = shownQty(p.id)
      if (status === 'out') return qty <= 0
      if (status === 'in') return qty > 0
      return p.minStock > 0 && qty <= p.minStock
    }
    return products
      .filter((p) => (cat ? p.category === cat : true))
      .filter(matches)
      .filter(inStatus)
      .sort((a, b) => {
        switch (sort) {
          case 'name-desc':
            return b.name.localeCompare(a.name)
          case 'sku-asc':
            return a.sku.localeCompare(b.sku)
          case 'sku-desc':
            return b.sku.localeCompare(a.sku)
          case 'qty-desc':
            return shownQty(b.id) - shownQty(a.id) || a.name.localeCompare(b.name)
          case 'qty-asc':
            return shownQty(a.id) - shownQty(b.id) || a.name.localeCompare(b.name)
          default:
            return a.name.localeCompare(b.name)
        }
      })
  }, [products, search, searchIn, cat, status, sort, shownQty])

  async function handleSeed() {
    setSeeding(true)
    try {
      const r = await seedInitialData()
      toast.success(t('นำเข้าสินค้า {products} รายการ, คลัง {locations} แห่ง', { products: r.products, locations: r.locations }))
    } catch (e) {
      toast.error(t("นำเข้าไม่สำเร็จ:") + ' ' + errText(e, t))
    } finally {
      setSeeding(false)
    }
  }

  async function handleReset() {
    const name = brand ? brandDef(brand).name : ''
    const ok = await confirm({
      title: t("ล้างและนำเข้าสินค้าใหม่"),
      message:
        t('ลบสินค้าทั้ง {count} รายการของ {brand} ทิ้ง (รวมรูปและยอดคงเหลือของสินค้านั้น) แล้วนำเข้าแคตตาล็อกจริงจากไฟล์รหัสสินค้า {catalog} รายการแทน?', {
          count: products.length,
          brand: name,
          catalog: catalogCount,
        }) +
        '\n\n' +
        t('ประวัติการเคลื่อนไหวจะยังอยู่ครบ แต่ยอดคงเหลือที่นับไว้จะหายทั้งหมด — ย้อนกลับไม่ได้'),
      danger: true,
      confirmText: t("ล้างและนำเข้าใหม่"),
    })
    if (!ok) return
    setResetting(true)
    try {
      const r = await resetCatalog()
      toast.success(t('ลบ {removed} รายการ, นำเข้าใหม่ {imported} รายการ', { removed: r.removed, imported: r.imported }))
    } catch (e) {
      toast.error(t("นำเข้าไม่สำเร็จ:") + ' ' + errText(e, t))
    } finally {
      setResetting(false)
    }
  }

  if (loading) return <Spinner label={t("กำลังโหลดสินค้า...")} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("สินค้าคงคลัง")}</h1>
          <p className="text-sm text-slate-500">{t('{n} รายการ', { n: products.length })}</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {products.length === 0 && catalogCount > 0 && (
              <Button variant="secondary" onClick={handleSeed} disabled={seeding}>
                {seeding ? t("กำลังนำเข้า...") : t('⬇️ นำเข้าแคตตาล็อกสินค้า ({n} รายการ)', { n: catalogCount })}
              </Button>
            )}
            {products.length > 0 && catalogCount > 0 && (
              <Button variant="secondary" onClick={handleReset} disabled={resetting}>
                {resetting ? t("กำลังนำเข้า...") : t("♻️ ล้างและนำเข้าใหม่")}
              </Button>
            )}
            <Button onClick={() => setCreating(true)}>{t("+ เพิ่มสินค้า")}</Button>
          </div>
        )}
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[260px] flex-1 gap-2">
            <Field label={t("ค้นหา")}>
              <Input
                placeholder={
                  searchIn === 'sku' ? t("เช่น VGT-01") : searchIn === 'name' ? t("เช่น MOZZARELLA") : t("ชื่อ / รหัส / หมวดหมู่...")
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            <Field label={t("ค้นจาก")}>
              <Select
                value={searchIn}
                onChange={(e) => setSearchIn(e.target.value as SearchIn)}
                className="w-[130px]"
              >
                <option value="all">{t("ทั้งหมด")}</option>
                <option value="name">{t("ชื่อสินค้า")}</option>
                <option value="sku">{t("รหัสสินค้า")}</option>
              </Select>
            </Field>
          </div>

          <Field label={t("หมวดหมู่")}>
            <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-[190px]">
              <option value="">{t("ทุกหมวดหมู่")}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("สถานะ")}>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StockStatus)}
              className="w-[140px]"
            >
              <option value="all">{t("ทุกสถานะ")}</option>
              <option value="low">{t("ใกล้หมด")}</option>
              <option value="out">{t("หมดสต๊อก")}</option>
              <option value="in">{t("มีของ")}</option>
            </Select>
          </Field>

          <Field label={t("ดูคงเหลือของ")}>
            <Select value={locId} onChange={(e) => setLocId(e.target.value)} className="w-[170px]">
              <option value="">{t("ทุกคลังรวมกัน")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.type === 'warehouse' ? '🏭' : '🏬'} {l.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("เรียงตาม")}>
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="w-[190px]"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {t(s.label)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
          <span>
            {t('แสดง {shown} จาก {total} รายการ', { shown: filtered.length, total: products.length })}
          </span>
          {filterCount > 0 && (
            <button onClick={clearFilters} className="font-medium text-red-700 hover:underline">
              {t('ล้างตัวกรอง ({n})', { n: filterCount })}
            </button>
          )}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          {products.length > 0 ? (
            <EmptyState icon="🔍" title={t("ไม่พบสินค้าที่ตรงกับตัวกรอง")} hint={t("ลองล้างตัวกรองแล้วค้นใหม่")} />
          ) : (
            <EmptyState
              icon="📦"
              title={t("ยังไม่มีสินค้า")}
              hint={isAdmin ? t("กด “นำเข้าแคตตาล็อกสินค้า” หรือ “เพิ่มสินค้า”") : t("ยังไม่มีข้อมูลสินค้า")}
            />
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-260px)]">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs uppercase text-slate-500 shadow-sm">
                <tr>
                  <th className="px-3 py-2">{t("สินค้า")}</th>
                  <th className="px-3 py-2">{t("หมวดหมู่")}</th>
                  <th className="px-3 py-2 text-right">
                    {locId ? locations.find((l) => l.id === locId)?.name : t("คงเหลือรวม")}
                  </th>
                  <th className="px-3 py-2 text-right">{t("ขั้นต่ำ")}</th>
                  <th className="px-3 py-2">{t("หน่วย")}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const total = shownQty(p.id)
                  const low = p.minStock > 0 && total <= p.minStock
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3">
                          <ProductThumb productId={p.id} hasImage={p.hasImage} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-800">{p.name}</div>
                            <div className="text-xs text-slate-400">{p.sku}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{p.category}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        <span className={low ? 'text-rose-600' : 'text-slate-800'}>
                          {fmtQty(total)}
                        </span>
                        {low && (
                          <span className="ml-2 align-middle">
                            <Badge color="red">{t("ใกล้หมด")}</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{fmtQty(p.minStock)}</td>
                      <td className="px-3 py-2 text-slate-600">{p.unitType}</td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" onClick={() => setEditing(p)}>
                          {isAdmin ? t("แก้ไข") : t("ดู")}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(creating || editing) && (
        <ProductEditor
          product={editing}
          categories={categories}
          canEdit={isAdmin}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function ProductEditor({
  product,
  categories,
  canEdit,
  onClose,
}: {
  product: Product | null
  categories: string[]
  canEdit: boolean
  onClose: () => void
}) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const { locations, qtyAt } = useData()
  const { user } = useAuth()
  const { brand } = useBrand()
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<ProductInput>({
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    category: product?.category ?? '',
    unit: product?.unit ?? t("หน่วย"),
    unitType: product?.unitType ?? 'EA',
    minStock: product?.minStock ?? 0,
    cost: product?.cost,
  })
  const [existingImg, setExistingImg] = useState<string | null>(null)
  const [newImg, setNewImg] = useState<string | null>(null)
  const [imageLoaded, setImageLoaded] = useState(!product?.hasImage)
  const [removeImg, setRemoveImg] = useState(false)
  const [busy, setBusy] = useState(false)
  // current on-hand quantity per location (editable) + the original values to detect changes
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [origCounts, setOrigCounts] = useState<Record<string, number>>({})

  // initialise editable on-hand quantities from the live balances
  useEffect(() => {
    if (!product) return
    const map: Record<string, number> = {}
    for (const l of locations) map[l.id] = qtyAt(l.id, product.id)
    setCounts(map)
    setOrigCounts(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, locations])

  // load existing image for preview
  useEffect(() => {
    let on = true
    if (product?.hasImage) {
      getProductImage(product.id).then((u) => {
        if (!on) return
        setExistingImg(u)
        setImageLoaded(true)
      })
    } else {
      setImageLoaded(true)
    }
    return () => {
      on = false
    }
  }, [product])

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const compressed = await compressImage(file)
      setNewImg(compressed)
      setRemoveImg(false)
    } catch {
      toast.error(t("อ่านรูปไม่สำเร็จ"))
    }
  }

  async function save() {
    if (!form.name.trim()) return toast.error(t("กรุณาใส่ชื่อสินค้า"))
    if (!form.category.trim()) return toast.error(t("กรุณาใส่หมวดหมู่"))
    setBusy(true)
    try {
      let id = product?.id
      if (id) {
        await updateProduct(id, form)
      } else {
        id = await createProduct(form)
      }
      // image handling
      if (newImg) {
        await setProductImage(id, newImg)
        invalidateThumb(id)
      } else if (removeImg && product?.hasImage) {
        await removeProductImage(id)
        invalidateThumb(id)
      }
      // apply on-hand quantity changes (records an audited "opening" adjustment per location)
      if (product && user) {
        for (const loc of locations) {
          const target = counts[loc.id] ?? 0
          if (Math.abs(target - (origCounts[loc.id] ?? 0)) > 1e-9) {
            await setStockCount({
              productId: id,
              productName: form.name.trim(),
              unit: form.unitType,
              locationId: loc.id,
              targetQty: target,
              actor: { id: user.id, name: user.name },
            })
          }
        }
      }
      toast.success(product ? t("บันทึกการแก้ไขแล้ว") : t("เพิ่มสินค้าแล้ว"))
      onClose()
    } catch (e) {
      toast.error(t("บันทึกไม่สำเร็จ:") + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!product) return
    const ok = await confirm({
      title: t("ลบสินค้า"),
      message: t('ลบ "{name}" ? ประวัติการเคลื่อนไหวจะยังคงอยู่ แต่สินค้าจะหายจากรายการ', { name: product.name }),
      danger: true,
      confirmText: t("ลบ"),
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteProduct(product.id)
      toast.success(t("ลบแล้ว"))
      onClose()
    } catch (e) {
      toast.error(t("ลบไม่สำเร็จ:") + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const preview = removeImg ? null : (newImg ?? existingImg)

  return (
    <Modal open onClose={onClose} title={product ? t("แก้ไขสินค้า") : t("เพิ่มสินค้า")} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2 flex items-center gap-4">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {!imageLoaded ? (
              <div className="flex h-full items-center justify-center text-slate-300">...</div>
            ) : preview ? (
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-3xl text-slate-300">
                {brand ? brandDef(brand).productIcon : '📦'}
              </div>
            )}
          </div>
          {canEdit && (
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={pickImage}
              />
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                {t("📷 เลือกรูป / ถ่ายรูป")}
              </Button>
              {preview && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setNewImg(null)
                    setRemoveImg(true)
                  }}
                >
                  {t("ลบรูป")}
                </Button>
              )}
              <p className="text-xs text-slate-400">{t("รูปจะถูกย่อให้เล็กอัตโนมัติ")}</p>
            </div>
          )}
        </div>

        <Field label={t("ชื่อสินค้า")} required>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            disabled={!canEdit}
          />
        </Field>
        <Field label={t("SKU / รหัส")}>
          <Input
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
            disabled={!canEdit}
          />
        </Field>
        <Field label={t("หมวดหมู่")} required>
          <Input
            list="cat-list"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            disabled={!canEdit}
          />
          <datalist id="cat-list">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label={t("หน่วยนับ (แสดงผล)")}>
          <Input
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
            placeholder={t("เช่น Kilogram, ขวด, แพ็ค")}
            disabled={!canEdit}
          />
        </Field>
        <Field label={t("ตัวย่อหน่วย")}>
          <Input
            value={form.unitType}
            onChange={(e) => setForm({ ...form, unitType: e.target.value })}
            placeholder={t("เช่น KG, EA, Pack")}
            disabled={!canEdit}
          />
        </Field>
        <Field label={t("สต๊อกขั้นต่ำ (แจ้งเตือนเมื่อถึง)")}>
          <Input
            type="number"
            step="any"
            min={0}
            value={form.minStock}
            onChange={(e) => setForm({ ...form, minStock: Number(e.target.value) })}
            disabled={!canEdit}
          />
        </Field>
        <Field label={t("ต้นทุน/หน่วย (ไม่บังคับ)")}>
          <Input
            type="number"
            step="any"
            min={0}
            value={form.cost ?? ''}
            onChange={(e) =>
              setForm({ ...form, cost: e.target.value === '' ? undefined : Number(e.target.value) })
            }
            disabled={!canEdit}
          />
        </Field>
      </div>

      {product && canEdit && (
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <div className="mb-1 text-sm font-semibold text-slate-700">
            {t("ยอดคงเหลือปัจจุบัน (พิมพ์จำนวนที่มีจริง)")}
          </div>
          <p className="mb-3 text-xs text-slate-400">
            {t("แก้ตัวเลขให้ตรงกับของจริงในคลัง — ระบบจะบันทึกเป็นรายการ “ตั้งยอด/ยอดยกมา” ให้อัตโนมัติ (เก็บประวัติครบ)")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {locations.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm text-slate-600">
                  {l.type === 'warehouse' ? '🏭' : '🏬'} {l.name}
                </span>
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={counts[l.id] ?? 0}
                  onChange={(e) => setCounts({ ...counts, [l.id]: Number(e.target.value) })}
                  className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-right text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                />
                <span className="w-10 text-sm text-slate-500">{form.unitType}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <div>
          {canEdit && product && (
            <Button variant="danger" onClick={remove} disabled={busy}>
              {t("ลบสินค้า")}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("ปิด")}
          </Button>
          {canEdit && (
            <Button onClick={save} disabled={busy}>
              {busy ? t("กำลังบันทึก...") : t("บันทึก")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
