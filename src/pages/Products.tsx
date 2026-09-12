import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
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
  PageHeader,
  Select,
  Spinner,
  blurOnWheel,
} from '../components/ui'
import { ProductThumb, invalidateThumb } from '../components/ProductThumb'
import { DataTable, type Column } from '../components/DataTable'
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
import { changeProductUnit, setStockCount } from '../services/stock'
import { useEntryUnits } from '../services/entryUnits'
import { sameUnit, unitNameFor } from '../lib/units'
import { compressImage } from '../lib/image'
import { fmtQty } from '../lib/format'
import type { Product } from '../types'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'

type SearchIn = 'all' | 'name' | 'sku'
type StockStatus = 'all' | 'low' | 'out' | 'in' | 'hidden'
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
  const { products, locations, qtyAt, qtyByUnit, minFor, tracksProduct, levels, minOverrides, loading } =
    useData()
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
  const [showFilters, setShowFilters] = useState(false)

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products])

  // Quantity the list works with: one location when the location filter is set, otherwise
  // every location added up. Both the "คงเหลือ" column and the qty sorts use this.
  const shownQty = useMemo(() => {
    const active = locId ? locations.filter((l) => l.id === locId) : locations
    return (productId: string) => active.reduce((sum, l) => sum + qtyAt(l.id, productId), 0)
  }, [locations, locId, qtyAt])

  /**
   * Balances keyed in some other unit, added up over the locations in view.
   *
   * These are deliberately kept apart from the number above rather than folded into it. Two
   * people recording the same delivery — one as "10 Pack", one as "2 KG" — leaves two
   * balances, and only a person can say which is right; a conversion here would be a guess
   * written into the stock figure.
   */
  const otherUnits = useMemo(() => {
    const active = locId ? locations.filter((l) => l.id === locId) : locations
    return (product: Product) => {
      const totals = new Map<string, number>()
      for (const l of active) {
        for (const row of qtyByUnit(l.id, product.id)) {
          if (row.unit === product.unitType) continue
          totals.set(row.unit, (totals.get(row.unit) ?? 0) + row.qty)
        }
      }
      return [...totals].map(([unit, qty]) => ({ unit, qty }))
    }
  }, [locations, locId, qtyByUnit])

  /**
   * The minimum this list should judge a product against.
   *
   * With a location chosen, that is the per-location override — the same number the
   * dashboard and the reports use. This page used the global `minStock` everywhere, so a
   * product with a global minimum of 5, an override of 20 at the branch and 10 on hand read
   * as "low" on the dashboard and "normal" here, and the "low stock" filter did not find it.
   */
  const minShown = useMemo(() => {
    return (p: Product) => (locId ? minFor(p, locId) : p.minStock)
  }, [locId, minFor])

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
      if (status === 'all' || status === 'hidden') return true
      const qty = shownQty(p.id)
      if (status === 'out') return qty <= 0
      if (status === 'in') return qty > 0
      const min = minShown(p)
      return min > 0 && qty <= min
    }
    return products
      // Hidden products stay out of the way unless they are what is being looked for.
      // Hiding is the alternative to deleting: the catalogue keeps the item, its history and
      // its balance, so putting it back is one click rather than keying it in again.
      .filter((p) => (status === 'hidden' ? p.active === false : p.active !== false))
      // Viewing one location lists what that location carries, not the whole catalogue with
      // zeros against it — a product that has never been sent to a branch is not a line the
      // branch is short of.
      .filter((p) => !locId || tracksProduct(locId, p.id))
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
  }, [products, search, searchIn, cat, status, sort, shownQty, minShown, locId, tracksProduct])

  async function toggleHidden(p: Product) {
    const hide = p.active !== false
    try {
      await updateProduct(p.id, { active: !hide })
      toast.success(hide ? t('ซ่อนแล้ว — ดูได้ที่ตัวกรอง "ที่ซ่อนไว้"') : t('เลิกซ่อนแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  async function handleSeed() {
    setSeeding(true)
    try {
      const r = await seedInitialData()
      toast.success(
        t('นำเข้าสินค้า {products} รายการ, คลัง {locations} แห่ง', { products: r.products, locations: r.locations, }),
      )
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
        t('ลบสินค้าทั้ง {count} รายการของ {brand} ทิ้ง (รวมรูปและยอดคงเหลือของสินค้านั้น) แล้วนำเข้าแคตตาล็อกจริงจากไฟล์รหัสสินค้า {catalog} รายการแทน?', { count: products.length, brand: name, catalog: catalogCount, }) +
        '\n\n' +
        t('ประวัติการเคลื่อนไหวจะยังอยู่ครบ แต่ยอดคงเหลือที่นับไว้จะหายทั้งหมด — ย้อนกลับไม่ได้'),
      danger: true,
      confirmText: t("ล้างและนำเข้าใหม่"),
      // The one action in the app that destroys counted stock with no way back.
      typeToConfirm: name,
    })
    if (!ok) return
    setResetting(true)
    try {
      const r = await resetCatalog()
      toast.success(
        t('ลบ {removed} รายการ, นำเข้าใหม่ {imported} รายการ', { removed: r.removed, imported: r.imported, }),
      )
    } catch (e) {
      toast.error(t("นำเข้าไม่สำเร็จ:") + ' ' + errText(e, t))
    } finally {
      setResetting(false)
    }
  }

  const columns = useMemo<Column<Product>[]>(
    () => [
      {
        key: 'product',
        header: t('สินค้า'),
        primary: true,
        cell: (p) => (
          <div className="flex items-center gap-3">
            <ProductThumb productId={p.id} hasImage={p.hasImage} />
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">{p.name}</div>
              <div className="doc-no text-xs text-ink-faint">{p.sku}</div>
            </div>
          </div>
        ),
      },
      { key: 'category', header: t('หมวดหมู่'), className: 'text-ink-soft', cell: (p) => p.category },
      {
        key: 'qty',
        header: locId ? (locations.find((l) => l.id === locId)?.name ?? '') : t('คงเหลือรวม'),
        align: 'right',
        className: 'num font-semibold',
        cell: (p) => {
          const total = shownQty(p.id)
          const low = minShown(p) > 0 && total <= minShown(p)
          const others = otherUnits(p)
          return (
            <>
              <span className={low ? 'font-semibold text-warn' : 'text-ink'}>{fmtQty(total)}</span>
              {low && (
                <span className="ml-2 align-middle">
                  <Badge color="red">{t('ใกล้หมด')}</Badge>
                </span>
              )}
              {/* Someone keyed this product in a unit of its own. Shown, never added. */}
              {others.map((o) => (
                <span key={o.unit} className="ml-2 align-middle">
                  <Badge color="amber">
                    {fmtQty(o.qty)} {o.unit}
                  </Badge>
                </span>
              ))}
            </>
          )
        },
      },
      {
        key: 'min',
        header: t('ขั้นต่ำ'),
        align: 'right',
        className: 'num text-ink-soft',
        cell: (p) => fmtQty(minShown(p)),
      },
      { key: 'unit', header: t('หน่วย'), className: 'text-ink-soft', cell: (p) => p.unitType },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tableOnly: true,
        cell: (p) => (
          <div className="flex items-center justify-end gap-1">
            {/* Hide rather than delete. A deleted product takes its history with it and has
                to be keyed in again from scratch; a hidden one is one click from coming
                back, with its balance and its movements intact. */}
            {isAdmin && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void toggleHidden(p)
                }}
                title={p.active === false ? t('เลิกซ่อนสินค้านี้') : t('ซ่อนสินค้านี้')}
                aria-label={p.active === false ? t('เลิกซ่อนสินค้านี้') : t('ซ่อนสินค้านี้')}
                className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors duration-150 hover:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40 ${
                  p.active === false ? 'text-warn' : 'text-ink-faint hover:text-ink'
                }`}
              >
                <Icon name={p.active === false ? 'eyeOff' : 'eye'} size={18} />
              </button>
            )}
            <Button
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation()
                setEditing(p)
              }}
            >
              {isAdmin ? t('แก้ไข') : t('ดู')}
            </Button>
          </div>
        ),
      },
    ],
    // shownQty and minShown read the live balances through the data context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locId, locations, isAdmin, levels, minOverrides],
  )


  if (loading) return <Spinner label={t("กำลังโหลดสินค้า...")} />

  return (
    <div className="space-y-4">
      <PageHeader
        icon="package"
        title={t("สินค้าคงคลัง")}
        subtitle={t('{n} รายการ', { n: products.length })}
        actions={
          isAdmin ? (
            <>
              {products.length === 0 && catalogCount > 0 && (
                <Button variant="secondary" onClick={handleSeed} disabled={seeding}>
                  {seeding ? (
                    t("กำลังนำเข้า...")
                  ) : (
                    <>
                      <Icon name="download" size={16} />
                      {t('นำเข้าแคตตาล็อกสินค้า ({n} รายการ)', { n: catalogCount, })}
                    </>
                  )}
                </Button>
              )}
              {products.length > 0 && catalogCount > 0 && (
                <Button variant="secondary" onClick={handleReset} disabled={resetting}>
                  {resetting ? (
                    t("กำลังนำเข้า...")
                  ) : (
                    <>
                      <Icon name="refresh" size={16} />
                      {t("ล้างและนำเข้าใหม่")}
                    </>
                  )}
                </Button>
              )}
              <Button onClick={() => setCreating(true)}>
                <Icon name="plus" size={16} />
                {t("เพิ่มสินค้า")}
              </Button>
            </>
          ) : undefined
        }
      />

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[260px] flex-1 gap-2">
            <Field label={t("ค้นหา")} className="min-w-0 flex-1">
              <Input
                placeholder={
                  searchIn === 'sku'
                    ? t("เช่น VGT-01")
                    : searchIn === 'name'
                      ? t("เช่น MOZZARELLA")
                      : t("ชื่อ / รหัส / หมวดหมู่...")
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

          <Button
            variant={showFilters || filterCount > 0 ? 'secondary' : 'ghost'}
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            aria-controls="product-filters"
          >
            <Icon name="adjust" size={16} />
            {filterCount > 0 ? t('ตัวกรอง ({n})', { n: filterCount }) : t('ตัวกรอง')}
            <Icon
              name="chevronDown"
              size={14}
              className={showFilters ? 'rotate-180 transition-transform' : 'transition-transform'}
            />
          </Button>
        </div>

        <div
          id="product-filters"
          // `hidden` alone would lose to the `flex` utility, so the collapsed state has to
          // be the class itself.
          className={
            showFilters ? 'mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3' : 'hidden'
          }
        >
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
              <option value="hidden">{t("ที่ซ่อนไว้")}</option>
            </Select>
          </Field>

          <Field label={t("ดูคงเหลือของ")}>
            <Select value={locId} onChange={(e) => setLocId(e.target.value)} className="w-[170px]">
              <option value="">{t("ทุกคลังรวมกัน")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
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

        <div className="mt-3 flex items-center gap-3 border-t border-line pt-2 text-xs text-ink-soft">
          <span>
            {t('แสดง {shown} จาก {total} รายการ', { shown: filtered.length, total: products.length, })}
          </span>
          {filterCount > 0 && (
            <button onClick={clearFilters} className="font-medium text-brand hover:underline">
              {t('ล้างตัวกรอง ({n})', { n: filterCount })}
            </button>
          )}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          {products.length > 0 ? (
            <EmptyState
              icon="search"
              title={t("ไม่พบสินค้าที่ตรงกับตัวกรอง")}
              hint={t("ลองล้างตัวกรองแล้วค้นใหม่")}
            />
          ) : (
            <EmptyState
              icon="package"
              title={t("ยังไม่มีสินค้า")}
              hint={
                isAdmin
                  ? t("กด “นำเข้าแคตตาล็อกสินค้า” หรือ “เพิ่มสินค้า”")
                  : t("ยังไม่มีข้อมูลสินค้า")
              }
            />
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            rows={filtered}
            columns={columns}
            rowKey={(p) => p.id}
            minWidth={640}
            maxHeight="calc(100vh - 260px)"
            onRowClick={(p) => setEditing(p)}
            cardActions={(p) => (
              <Button variant="secondary" onClick={() => setEditing(p)}>
                {isAdmin ? t('แก้ไข') : t('ดู')}
              </Button>
            )}
          />
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
  /** Set once this dialog has created a product, so a retry updates it instead of adding another. */
  const [createdId, setCreatedId] = useState<string | null>(null)
  /**
   * A product that has been counted or moved cannot change its unit.
   *
   * Switching KG to EA does not convert anything: the balance keeps its number and gains a
   * new meaning, and every past movement still says KG. Only a person knows how many pieces
   * are in a kilogram of this particular thing, so the app refuses rather than guesses. The
   * service enforces it; this just stops the form offering something that will be rejected.
   */
  /**
   * The units this product may be measured in: the owner's list from Settings, plus whatever
   * this product already uses if that is no longer on it — editing an old product must not
   * silently change its unit just because the list has moved on.
   */
  const plainUnits = useEntryUnits()
  const unitChoices = useMemo(() => {
    const out = [...plainUnits]
    if (form.unitType && !out.some((u) => sameUnit(u, form.unitType))) out.unshift(form.unitType)
    return out
  }, [plainUnits, form.unitType])

  /** One choice sets both boxes, because they are two views of the same fact. */
  function pickUnit(abbreviation: string) {
    setForm((f) => ({ ...f, unitType: abbreviation, unit: unitNameFor(abbreviation) }))
  }

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
    // A product with no unit cannot be received against, counted, or reported on.
    if (!form.unitType.trim()) return toast.error(t("กรุณาเลือกหน่วย"))
    setBusy(true)
    try {
      // Saving is several writes: the product, then its image, then a stock count per
      // location. If a later one failed, the dialog stayed open still believing it was
      // creating something new, so pressing save again made a SECOND product. Remembering
      // the id the first attempt created turns a retry into finishing the job.
      let id = product?.id ?? createdId
      if (id) {
        // Correcting the unit restamps every row already filed under the old one, so it is
        // its own operation rather than a field in the patch. It runs first: if it fails,
        // nothing else has been written and the product still reads as it did.
        // Compared loosely on purpose: the catalogue holds "Kilogram" where the list now
        // offers "kilogram", and a difference of capitals is not a change of unit. Treating
        // it as one would restamp a product's whole ledger every time somebody opened it and
        // pressed save.
        const unitChanged =
          !!product &&
          (!sameUnit(product.unitType, form.unitType) || !sameUnit(product.unit, form.unit))
        if (unitChanged && user) {
          const touched = await changeProductUnit({
            productId: id,
            unitType: form.unitType,
            unit: form.unit,
            actor: { id: user.id, name: user.name },
          })
          if (touched > 0) {
            toast.success(t('เปลี่ยนหน่วยแล้ว — ปรับประวัติเก่า {count} รายการ', { count: touched }))
          }
        }
        await updateProduct(id, form)
      } else {
        id = await createProduct(form)
        setCreatedId(id)
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
      message: t('ลบ "{name}" ? ประวัติการเคลื่อนไหวจะยังคงอยู่ แต่สินค้าจะหายจากรายการ', { name: product.name, }),
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
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-line bg-sunken">
            {!imageLoaded ? (
              <div className="flex h-full items-center justify-center text-ink-faint">...</div>
            ) : preview ? (
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-3xl text-ink-faint">
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
                <Icon name="camera" size={16} />
                {t("เลือกรูป / ถ่ายรูป")}
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
              <p className="text-xs text-ink-faint">{t("รูปจะถูกย่อให้เล็กอัตโนมัติ")}</p>
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
        {/* Two boxes for one fact, so they are driven by one list and set together. Typed
            by hand they drifted — "Kilogram" against "EA", or a unit nobody could receive
            against because it matched nothing in the entry list. */}
        <Field label={t("หน่วยนับ (แสดงผล)")} required>
          <Select
            value={form.unitType}
            onChange={(e) => pickUnit(e.target.value)}
            disabled={!canEdit}
          >
            <option value="">{t("— เลือกหน่วย —")}</option>
            {unitChoices.map((u) => (
              <option key={u} value={u}>
                {unitNameFor(u)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("ตัวย่อหน่วย")} required>
          <Select
            value={form.unitType}
            onChange={(e) => pickUnit(e.target.value)}
            disabled={!canEdit}
          >
            <option value="">{t("— เลือกหน่วย —")}</option>
            {unitChoices.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
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
              setForm({
                ...form,
                cost: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
            disabled={!canEdit}
          />
        </Field>
      </div>

      {product && canEdit && (
        <div className="mt-5 rounded-lg border border-line bg-sunken/60 p-4">
          <div className="mb-1 text-sm font-semibold text-ink">
            {t("ยอดคงเหลือปัจจุบัน (พิมพ์จำนวนที่มีจริง)")}
          </div>
          <p className="mb-3 text-xs text-ink-faint">
            {t('แก้ตัวเลขให้ตรงกับของจริงในคลัง — ระบบจะบันทึกเป็นรายการ “ตั้งยอด/ยอดยกมา” ให้อัตโนมัติ (เก็บประวัติครบ)')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {locations.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm text-ink-soft">{l.name}</span>
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={counts[l.id] ?? 0}
                  onWheel={blurOnWheel}
                  onChange={(e) => setCounts({ ...counts, [l.id]: Number(e.target.value) })}
                  className="num min-h-11 w-28 rounded-lg border border-line-strong px-3 py-2 text-right text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
                />
                <span className="w-10 text-sm text-ink-soft">{form.unitType}</span>
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
