import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { SiteSelect } from '../components/SiteChip'
import { useData, useLedgerWindow } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { Button, EmptyState, Field, Input, Modal, Pagination, SearchInput, Select, Spinner, blurOnWheel } from '../components/ui'
import { ChipRow, FilterBar, FilterField, FramePage, PageHero, SectionCard, type Chip } from '../components/frame'
import { DataTable } from '../components/DataTable'
import { BarcodeScanner } from '../components/BarcodeScanner'
import { BarcodeImportModal } from './products/BarcodeImportModal'
import { updateProduct } from '../services/products'
import { catalogSize, resetCatalog, seedInitialData } from '../services/seed'
import { exportExcel } from '../lib/export'
import { fmtQty } from '../lib/format'
import { valueAsOf } from '../lib/stats/periodCompare'
import { DAY_MS } from '../lib/inventoryRules/time'
import { usePaged } from '../lib/usePaged'
import type { Product } from '../types'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import { looseMatch } from '../lib/search'
import { ProductEditor } from './products/ProductEditor'
import { ProductStats } from './products/ProductStats'
import { ProductGrid, productColumns, productMenu, type ProductRow } from './products/ProductTable'
import { STATE_LOOK, stockState, type StockState } from './products/productStatus'

type StatusFilter = 'all' | StockState | 'in' | 'hidden'
type SortKey = 'name-asc' | 'name-desc' | 'sku-asc' | 'sku-desc' | 'qty-desc' | 'qty-asc' | 'updated-desc'
type View = 'table' | 'grid'

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name-asc', label: 'ชื่อสินค้า (A - Z)' }, // i18n-key
  { value: 'name-desc', label: 'ชื่อสินค้า (Z - A)' }, // i18n-key
  { value: 'sku-asc', label: 'รหัสสินค้า น้อย→มาก' }, // i18n-key
  { value: 'sku-desc', label: 'รหัสสินค้า มาก→น้อย' }, // i18n-key
  { value: 'qty-desc', label: 'คงเหลือ มาก→น้อย' }, // i18n-key
  { value: 'qty-asc', label: 'คงเหลือ น้อย→มาก' }, // i18n-key
  { value: 'updated-desc', label: 'อัปเดตล่าสุดก่อน' }, // i18n-key
]

/** How many category chips sit above the list; the rest are in the dropdown. */
const CHIP_LIMIT = 8
const VIEW_KEY = 'pzm:products:view'

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'table'
  } catch {
    return 'table'
  }
}

/**
 * สินค้าคงคลัง, as the owner's mock-up 02 draws it (spec §2.2): five figures that double as
 * the status filter, a filter card with category chips, and the list as a table or a grid,
 * paged, with tick boxes for acting on several products at once.
 */
export function ProductsPage() {
  const t = useT()
  const navigate = useNavigate()
  const { products, locations, qtyAt, qtyByUnit, minFor, tracksProduct, levels, movements, movementsFrom, loading } = useData()
  // The stock-value figure is "against a month ago", so a month of ledger is asked for.
  useLedgerWindow()
  const { user } = useAuth()
  const { brand } = useBrand()
  const toast = useToast()
  const confirm = useConfirm()
  const isAdmin = user?.role === 'admin'
  const catalogCount = brand ? catalogSize(brand) : 0

  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [locId, setLocId] = useState('')
  const [sort, setSort] = useState<SortKey>('name-asc')
  const [view, setViewState] = useState<View>(readView)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [settingMin, setSettingMin] = useState(false)
  // Which product a scan is about to be attached to (spec §3).
  const [binding, setBinding] = useState<Product | null>(null)
  const [importingBarcodes, setImportingBarcodes] = useState(false)

  function setView(v: View) {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* private window — the choice lasts until reload */
    }
  }

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products])
  const siteName = (id: string) => locations.find((l) => l.id === id)?.name ?? ''

  /**
   * Every product worked out once for the locations in view: its balance, its minimum, its
   * state, where it is held and when its balance last changed.
   *
   * With a location chosen, the minimum is that location's override — the same number the
   * dashboard and the reports use — and the list is what that location carries, not the
   * whole catalogue with zeros against it.
   */
  const allRows = useMemo<ProductRow[]>(() => {
    const inView = locId ? locations.filter((l) => l.id === locId) : locations
    const inViewIds = new Set(inView.map((l) => l.id))
    const updated = new Map<string, number>()
    for (const lv of levels) {
      if (!inViewIds.has(lv.locationId)) continue
      if ((updated.get(lv.productId) ?? 0) < lv.updatedAt) updated.set(lv.productId, lv.updatedAt)
    }
    return products
      .filter((p) => !locId || tracksProduct(locId, p.id))
      .map((p) => {
        let qty = 0
        const sites: string[] = []
        const others = new Map<string, number>()
        for (const l of inView) {
          const q = qtyAt(l.id, p.id)
          qty += q
          if (q > 0) sites.push(l.id)
          for (const row of qtyByUnit(l.id, p.id)) {
            if (row.unit === p.unitType) continue
            others.set(row.unit, (others.get(row.unit) ?? 0) + row.qty)
          }
        }
        const min = locId ? minFor(p, locId) : p.minStock
        return {
          p,
          qty,
          min,
          state: stockState(qty, min),
          sites,
          updatedAt: updated.get(p.id) ?? 0,
          others: [...others].map(([unit, q]) => ({ unit, qty: q })),
        }
      })
  }, [products, locations, locId, levels, qtyAt, qtyByUnit, minFor, tracksProduct])

  const activeRows = useMemo(() => allRows.filter((r) => r.p.active !== false), [allRows])
  const hiddenCount = allRows.length - activeRows.length

  const counts = useMemo(() => {
    const c: Record<StockState, number> = { normal: 0, low: 0, out: 0 }
    for (const r of activeRows) c[r.state]++
    return c
  }, [activeRows])

  const value = useMemo(() => activeRows.reduce((s, r) => s + Math.max(0, r.qty) * (r.p.cost ?? 0), 0), [activeRows])
  const valueBefore = useMemo(() => {
    const costs = new Map(products.map((p) => [p.id, p.cost ?? 0]))
    const scope = locId ? new Set([locId]) : undefined
    return valueAsOf(value, movements, Date.now() - 30 * DAY_MS, movementsFrom, (id) => costs.get(id) ?? 0, scope)
  }, [value, products, movements, movementsFrom, locId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = (status === 'hidden' ? allRows.filter((r) => r.p.active === false) : activeRows)
      .filter((r) => (cat ? r.p.category === cat : true))
      .filter((r) => !q || looseMatch([r.p.name, r.p.sku, r.p.category], q))
      .filter((r) => {
        if (status === 'all' || status === 'hidden') return true
        if (status === 'in') return r.qty > 0
        return r.state === status
      })
    const byName = (a: ProductRow, b: ProductRow) => a.p.name.localeCompare(b.p.name)
    return rows.sort((a, b) => {
      switch (sort) {
        case 'name-desc':
          return b.p.name.localeCompare(a.p.name)
        case 'sku-asc':
          return a.p.sku.localeCompare(b.p.sku)
        case 'sku-desc':
          return b.p.sku.localeCompare(a.p.sku)
        case 'qty-desc':
          return b.qty - a.qty || byName(a, b)
        case 'qty-asc':
          return a.qty - b.qty || byName(a, b)
        case 'updated-desc':
          return b.updatedAt - a.updatedAt || byName(a, b)
        default:
          return byName(a, b)
      }
    })
  }, [allRows, activeRows, search, cat, status, sort])

  const { rows: pageRows, pager } = usePaged(filtered, 20, `${search}|${cat}|${status}|${locId}|${sort}`)

  // Category chips: the biggest few by count, plus the one chosen from the dropdown if it
  // is not among them — twenty chips in a row would push the list off the screen.
  const chips = useMemo<Chip<string>[]>(() => {
    const n = new Map<string, number>()
    for (const r of activeRows) n.set(r.p.category, (n.get(r.p.category) ?? 0) + 1)
    const top = [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, CHIP_LIMIT)
    if (cat && !top.some(([c]) => c === cat)) top.push([cat, n.get(cat) ?? 0])
    return [{ key: '', label: t('ทั้งหมด'), count: activeRows.length }, ...top.map(([c, count]) => ({ key: c, label: c, count }))]
  }, [activeRows, cat, t])

  const filterCount = (search.trim() ? 1 : 0) + (cat ? 1 : 0) + (status !== 'all' ? 1 : 0) + (locId ? 1 : 0)
  function clearFilters() {
    setSearch('')
    setCat('')
    setStatus('all')
    setLocId('')
  }

  async function toggleHidden(p: Product) {
    const hide = p.active !== false
    try {
      await updateProduct(p.id, { active: !hide })
      toast.success(hide ? t('ซ่อนแล้ว — ดูได้ที่ตัวกรอง "ที่ซ่อนไว้"') : t('เลิกซ่อนแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  const chosen = useMemo(() => allRows.filter((r) => selected.has(r.p.id)), [allRows, selected])

  async function hideChosen() {
    const targets = chosen.filter((r) => r.p.active !== false)
    if (targets.length === 0) return
    const ok = await confirm({
      title: t('ซ่อนสินค้าที่เลือก'),
      message: t('ซ่อน {n} รายการ? ยอดและประวัติยังอยู่ครบ เลิกซ่อนได้จากตัวกรอง "ที่ซ่อนไว้"', { n: targets.length }),
      confirmText: t('ซ่อน'),
    })
    if (!ok) return
    try {
      for (const r of targets) await updateProduct(r.p.id, { active: false })
      toast.success(t('ซ่อนแล้ว {n} รายการ', { n: targets.length }))
      setSelected(new Set())
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  function exportChosen() {
    const rows = (chosen.length ? chosen : filtered).map((r) => ({
      [t('รหัสสินค้า')]: r.p.sku,
      [t('ชื่อสินค้า')]: r.p.name,
      [t('หมวดหมู่')]: r.p.category,
      [t('หน่วย')]: r.p.unitType,
      [t('คงเหลือ')]: r.qty,
      [t('จุดสั่งซื้อ')]: r.min,
      [t('สถานะ')]: r.p.active === false ? t('ที่ซ่อนไว้') : t(STATE_LOOK[r.state].label),
      [t('คลังสินค้า')]: locId ? siteName(locId) : r.sites.map(siteName).join(', '),
    }))
    exportExcel(`products-${new Date().toISOString().slice(0, 10)}`, t('สินค้าคงคลัง'), rows)
  }

  async function handleSeed() {
    setSeeding(true)
    try {
      const r = await seedInitialData()
      toast.success(t('นำเข้าสินค้า {products} รายการ, คลัง {locations} แห่ง', { products: r.products, locations: r.locations }))
    } catch (e) {
      toast.error(t('นำเข้าไม่สำเร็จ:') + ' ' + errText(e, t))
    } finally {
      setSeeding(false)
    }
  }

  async function handleReset() {
    const name = brand ? brandDef(brand).name : ''
    const ok = await confirm({
      title: t('ล้างและนำเข้าสินค้าใหม่'),
      message:
        t('ลบสินค้าทั้ง {count} รายการของ {brand} ทิ้ง (รวมรูปและยอดคงเหลือของสินค้านั้น) แล้วนำเข้าแคตตาล็อกจริงจากไฟล์รหัสสินค้า {catalog} รายการแทน?', { count: products.length, brand: name, catalog: catalogCount }) +
        '\n\n' +
        t('ประวัติการเคลื่อนไหวจะยังอยู่ครบ แต่ยอดคงเหลือที่นับไว้จะหายทั้งหมด — ย้อนกลับไม่ได้'),
      danger: true,
      confirmText: t('ล้างและนำเข้าใหม่'),
      // The one action in the app that destroys counted stock with no way back.
      typeToConfirm: name,
    })
    if (!ok) return
    setResetting(true)
    try {
      const r = await resetCatalog()
      toast.success(t('ลบ {removed} รายการ, นำเข้าใหม่ {imported} รายการ', { removed: r.removed, imported: r.imported }))
    } catch (e) {
      toast.error(t('นำเข้าไม่สำเร็จ:') + ' ' + errText(e, t))
    } finally {
      setResetting(false)
    }
  }

  const columns = useMemo(() => productColumns(t, siteName, locId), [t, locId, locations]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner label={t('กำลังโหลดสินค้า...')} />

  return (
    <FramePage>
      <PageHero
        icon="package"
        title={t('สินค้าคงคลัง')}
        subtitle={t('ตรวจสอบสต๊อกคงเหลือ จัดการสินค้า และติดตามสถานะสินค้า')}
        actions={
          isAdmin ? (
            <>
              {products.length === 0 && catalogCount > 0 && (
                <Button variant="secondary" onClick={handleSeed} disabled={seeding}>
                  {seeding ? t('กำลังนำเข้า...') : (
                    <>
                      <Icon name="download" size={16} />
                      {t('นำเข้าแคตตาล็อกสินค้า ({n} รายการ)', { n: catalogCount })}
                    </>
                  )}
                </Button>
              )}
              {products.length > 0 && catalogCount > 0 && (
                <span className="hidden md:contents">
                  <Button variant="secondary" onClick={handleReset} disabled={resetting}>
                    {resetting ? t('กำลังนำเข้า...') : (
                      <>
                        <Icon name="refresh" size={16} />
                        {t('ล้างและนำเข้าใหม่')}
                      </>
                    )}
                  </Button>
                </span>
              )}
              <Button variant="secondary" onClick={() => setImportingBarcodes(true)} className="hidden md:inline-flex">
                <Icon name="barcode" size={16} />
                {t('นำเข้าบาร์โค้ด')}
              </Button>
              <Link
                to="/import"
                className="hidden min-h-11 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:bg-sunken md:inline-flex"
              >
                <Icon name="upload" size={16} />
                {t('นำเข้า Excel (เพิ่ม/อัปเดต)')}
              </Link>
              <Button onClick={() => setCreating(true)}>
                <Icon name="plus" size={16} />
                {t('เพิ่มสินค้าใหม่')}
              </Button>
            </>
          ) : undefined
        }
      />

      <ProductStats
        total={activeRows.length}
        hidden={hiddenCount}
        counts={counts}
        value={value}
        valueBefore={valueBefore}
        selected={status === 'normal' || status === 'low' || status === 'out' ? status : null}
        onSelect={(s) => setStatus(s ?? 'all')}
      />

      <FilterBar
        search={<SearchInput value={search} onChange={setSearch} placeholder={t('ค้นหาสินค้า ชื่อสินค้า, SKU, หมวดหมู่...')} />}
        onReset={clearFilters}
        resetDisabled={filterCount === 0}
        below={<ChipRow label={t('หมวดหมู่')} chips={chips} value={cat} onChange={setCat} />}
      >
        <FilterField label={t('หมวดหมู่')}>
          <Select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">{t('ทั้งหมด')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label={t('สถานะสต๊อก')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="all">{t('ทั้งหมด')}</option>
            <option value="normal">{t('ปกติ')}</option>
            <option value="low">{t('ใกล้หมด')}</option>
            <option value="out">{t('หมดสต๊อก')}</option>
            <option value="in">{t('มีของ')}</option>
            <option value="hidden">{t('ที่ซ่อนไว้')}</option>
          </Select>
        </FilterField>
        <FilterField label={t('คลังสินค้า')}>
          <SiteSelect value={locId} onChange={setLocId} locations={locations} emptyLabel={t('ทั้งหมด')} className="w-full" />
        </FilterField>
      </FilterBar>

      <SectionCard
        title={t('รายการสินค้า')}
        count={t('({n} รายการ)', { n: filtered.length })}
        flush
        actions={
          <>
            <label className="flex items-center gap-2 whitespace-nowrap text-sm text-ink-soft">
              <Icon name="swap" size={16} className="rotate-90" />
              <span className="hidden sm:inline">{t('เรียงตาม')}</span>
              <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-auto min-w-44">
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {t(s.label)}
                  </option>
                ))}
              </Select>
            </label>
            <div className="hidden overflow-hidden rounded-lg border border-line md:flex" role="group" aria-label={t('มุมมอง')}>
              {(['table', 'grid'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  aria-label={v === 'table' ? t('มุมมองตาราง') : t('มุมมองการ์ด')}
                  onClick={() => setView(v)}
                  className={`inline-flex h-11 w-11 cursor-pointer items-center justify-center ${view === v ? 'bg-brand text-white' : 'bg-surface text-ink-soft hover:bg-sunken'}`}
                >
                  <Icon name={v === 'table' ? 'list' : 'grid'} size={18} />
                </button>
              ))}
            </div>
          </>
        }
      >
        {filtered.length === 0 ? (
          products.length > 0 ? (
            <EmptyState icon="search" title={t('ไม่พบสินค้าที่ตรงกับตัวกรอง')} hint={t('ลองล้างตัวกรองแล้วค้นใหม่')} />
          ) : (
            <EmptyState
              icon="package"
              title={t('ยังไม่มีสินค้า')}
              hint={isAdmin ? t('กด “นำเข้าแคตตาล็อกสินค้า” หรือ “เพิ่มสินค้า”') : t('ยังไม่มีข้อมูลสินค้า')}
            />
          )
        ) : (
          <div className="pb-4">
            {view === 'grid' ? (
              <div className="px-4 md:px-5">
                <ProductGrid rows={pageRows} onOpen={setEditing} t={t} />
              </div>
            ) : (
              <div className="md:px-5">
                <DataTable
                  rows={pageRows}
                  columns={columns}
                  rowKey={(r) => r.p.id}
                  minWidth={960}
                  onRowClick={(r) => setEditing(r.p)}
                  selection={{ selected, onChange: setSelected }}
                  rowMenu={(r) =>
                    productMenu(r, t, {
                      isAdmin,
                      locId,
                      go: navigate,
                      edit: () => setEditing(r.p),
                      toggleHidden: () => void toggleHidden(r.p),
                      bindBarcode: () => setBinding(r.p),
                    })
                  }
                />
              </div>
            )}
            <div className="px-4 md:px-5">
              <Pagination {...pager} sizes={[10, 20, 50, 100]} />
            </div>
          </div>
        )}
      </SectionCard>

      {/* Acting on several at once — tablet and up, where the tick boxes are. */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-20 hidden flex-wrap items-center gap-2 rounded-2xl border border-brand/30 bg-surface px-4 py-3 shadow-lg md:flex">
          <span className="mr-auto text-sm font-semibold text-ink">{t('เลือก {n} รายการ', { n: selected.size })}</span>
          {isAdmin && (
            <>
              <Button variant="secondary" size="sm" onClick={() => void hideChosen()}>
                <Icon name="eyeOff" size={16} />
                {t('ซ่อน')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setSettingMin(true)}>
                <Icon name="adjust" size={16} />
                {t('ตั้งขั้นต่ำ')}
              </Button>
            </>
          )}
          <Button variant="sheet" size="sm" onClick={exportChosen}>
            <Icon name="fileSheet" size={16} />
            {t('ส่งออก Excel')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            {t('ล้างที่เลือก')}
          </Button>
        </div>
      )}

      {importingBarcodes && (
        <BarcodeImportModal products={products} onClose={() => setImportingBarcodes(false)} onDone={() => undefined} />
      )}

      {binding && (
        <BarcodeScanner
          open
          title={t('ผูกบาร์โค้ดกับ "{name}"', { name: binding.name })}
          onClose={() => setBinding(null)}
          onRead={async (code) => {
            const target = binding
            setBinding(null)
            if (!target) return
            try {
              await updateProduct(target.id, { barcode: code })
              toast.success(t('ผูกบาร์โค้ด {code} กับ "{name}" แล้ว', { code, name: target.name }))
            } catch (e) {
              toast.error(errText(e, t))
            }
          }}
        />
      )}

      {settingMin && (
        <SetMinModal
          count={chosen.length}
          onClose={() => setSettingMin(false)}
          onSave={async (min) => {
            try {
              for (const r of chosen) await updateProduct(r.p.id, { minStock: min })
              toast.success(t('ตั้งขั้นต่ำ {min} ให้ {n} รายการแล้ว', { min: fmtQty(min), n: chosen.length }))
              setSettingMin(false)
              setSelected(new Set())
            } catch (e) {
              toast.error(errText(e, t))
            }
          }}
        />
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
    </FramePage>
  )
}

/**
 * One minimum for every ticked product. This is the catalogue-wide minimum
 * (`minStock`); a site's own override is still set on the product.
 */
function SetMinModal({ count, onClose, onSave }: { count: number; onClose: () => void; onSave: (min: number) => Promise<void> }) {
  const t = useT()
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const n = Number(value)
  const valid = value.trim() !== '' && Number.isFinite(n) && n >= 0
  return (
    <Modal
      open
      compact
      onClose={onClose}
      title={t('ตั้งขั้นต่ำให้ {n} รายการ', { n: count })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('ยกเลิก')}
          </Button>
          <Button
            disabled={!valid || saving}
            onClick={async () => {
              setSaving(true)
              await onSave(n)
              setSaving(false)
            }}
          >
            {t('บันทึก')}
          </Button>
        </div>
      }
    >
      <Field label={t('สต๊อกขั้นต่ำ (แจ้งเตือนเมื่อต่ำ)')} hint={t('ใช้กับทุกคลัง — ขั้นต่ำเฉพาะคลังยังตั้งได้ที่หน้าสินค้า')}>
        <Input type="number" min={0} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} onWheel={blurOnWheel} autoFocus />
      </Field>
    </Modal>
  )
}
