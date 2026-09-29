import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { SiteChip } from '../../components/SiteChip'
import { useData } from '../../data/DataContext'
import { useAuth } from '../../auth/AuthContext'
import { useBrand } from '../../brand/BrandContext'
import { brandDef } from '../../brand/brand'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/Confirm'
import {
  Button,
  Field,
  Input,
  Modal,
  Select,
  blurOnWheel,
} from '../../components/ui'
import { invalidateThumb } from '../../components/ProductThumb'
import { loadProductImage } from '../../services/productImageCache'
import { BarcodeScanner } from '../../components/BarcodeScanner'
import { ConversionRows } from '../../components/ConversionRows'
import {
  createProduct,
  updateProduct,
  deleteProduct,
  setProductImage,
  removeProductImage,
  type ProductInput,
} from '../../services/products'
import { changeProductUnit, setStockCount } from '../../services/stock'
import { useEntryUnits } from '../../services/entryUnits'
import { useSuppliers } from '../../services/suppliers'
import { sameUnit, unitNameFor } from '../../lib/units'
import { compressImage } from '../../lib/image'
import type { CostEntry, Product } from '../../types'
import { CostBlock, type PriceDraft } from '../../components/CostBlock'
import { setProductCost } from '../../services/productCost'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'


export function ProductEditor({
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
  const [scanning, setScanning] = useState(false)
  const [form, setForm] = useState<ProductInput>({
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    name: product?.name ?? '',
    category: product?.category ?? '',
    unit: product?.unit ?? t("หน่วย"),
    unitType: product?.unitType ?? 'EA',
    minStock: product?.minStock ?? 0,
    cost: product?.cost,
    supplierId: product?.supplierId,
    alternateSupplierIds: product?.alternateSupplierIds ?? [],
    unitConversions: product?.unitConversions ?? [],
  })
  // Prices are stated through the cost block and written by services/productCost.ts,
  // never through the form: the form's `cost` is read-only here (owner, 22 Sep 2026).
  const [costHistory, setCostHistory] = useState<CostEntry[]>(product?.costHistory ?? [])
  const [priceDraft, setPriceDraft] = useState<PriceDraft | null>(null)
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
  // Read once per session, not once per dialog: it is about a hundred documents.
  const supplierChoices = useSuppliers()
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
      // Through the device's copy: opening the editor should not cost a read the list already paid.
      loadProductImage(brand, product.id, product.updatedAt).then((u) => {
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
  }, [product, brand])

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
        const { cost: _cost, ...patch } = form
        void _cost
        await updateProduct(id, patch)
      } else {
        const { cost: _cost, ...input } = form
        void _cost
        id = await createProduct(input)
        setCreatedId(id)
        // A price keyed on a new product rides along with the creation.
        if (priceDraft && user) {
          await setProductCost({ productId: id, ...priceDraft, actor: { id: user.id, name: user.name } })
        }
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
        {/* The number on the box (owner, 22 Sep 2026). The SKU stays the identity; this is
            a second way to find the product, and a scan fills it in. */}
        <Field label={t('บาร์โค้ด')} hint={t('ไม่บังคับ — ใช้ค้นหาและสแกนตอนคีย์ของ')}>
          <div className="flex gap-2">
            <Input
              value={form.barcode ?? ''}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              disabled={!canEdit}
              inputMode="numeric"
              placeholder={t('เช่น 8851000654321')}
            />
            {canEdit && (
              <Button variant="secondary" onClick={() => setScanning(true)} className="shrink-0">
                <Icon name="barcode" size={18} />
                {t('สแกน')}
              </Button>
            )}
          </div>
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
        {/* Most products name their supplier in brackets and were linked by the import.
            This is for the handful whose names never did, and for changing one by hand. */}
        <Field label={t("ผู้ขาย")}>
          <Select
            value={form.supplierId ?? ''}
            onChange={(e) => setForm({ ...form, supplierId: e.target.value || undefined })}
            disabled={!canEdit}
          >
            <option value="">{t("— ยังไม่ระบุ —")}</option>
            {/* An id that matches nobody here (a supplier deleted, or one from the other
                brand) is shown as such rather than quietly reading as "not set" — the
                person sees there is something to fix and can pick the right one. */}
            {form.supplierId && !supplierChoices.some((s) => s.id === form.supplierId) && (
              <option value={form.supplierId}>{t('ผู้ขายที่ไม่พบในแบรนด์นี้ — เลือกใหม่')}</option>
            )}
            {/* Hidden suppliers are not offered — except the one this product already has,
                or the select would show blank for a product whose supplier was hidden. */}
            {supplierChoices
              .filter((s) => s.active !== false || s.id === form.supplierId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.active === false ? ` (${t('ซ่อนไว้')})` : ''}
                </option>
              ))}
          </Select>
        </Field>
        {/* Who else sells it. The automatic order never picks one of these by itself; it is
            the list a person sees when the usual supplier cannot deliver. */}
        {supplierChoices.filter((s) => s.active !== false && s.id !== form.supplierId).length >
          0 && (
          <Field label={t('ผู้ขายสำรอง (ไม่บังคับ)')}>
            <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-lg border border-line p-2 text-sm">
              {supplierChoices
                .filter((s) => s.active !== false && s.id !== form.supplierId)
                .map((s) => {
                  const on = (form.alternateSupplierIds ?? []).includes(s.id)
                  return (
                    <label key={s.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const cur = form.alternateSupplierIds ?? []
                          setForm({
                            ...form,
                            alternateSupplierIds: e.target.checked
                              ? [...cur, s.id]
                              : cur.filter((id) => id !== s.id),
                          })
                        }}
                      />
                      <span className="text-ink">{s.name}</span>
                    </label>
                  )
                })}
            </div>
          </Field>
        )}
      </div>

      <CostBlock
        product={{ name: form.name, unitType: form.unitType, unitConversions: form.unitConversions }}
        history={costHistory}
        disabled={!canEdit}
        onSave={
          product && user
            ? async (d) => {
                try {
                  const entry = await setProductCost({ productId: product.id, ...d, actor: { id: user.id, name: user.name } })
                  setCostHistory((h) => [...h, entry])
                  toast.success(t('บันทึกราคาแล้ว — ฿{cost} ต่อ {unit}', { cost: entry.cost, unit: form.unitType }))
                } catch (e) {
                  toast.error(errText(e, t))
                }
              }
            : undefined
        }
        onDraft={product ? undefined : setPriceDraft}
      />

      {/**
       * The rates this product is keyed at: "1 ลัง = 288 EA". Authoritative since 20 Sep
       * 2026 — the item ordered by the case, issued by the pack and received by the piece
       * is one balance in EA, and every screen converts with these (lib/uom.ts). Anyone may
       * add one the first time they key a unit; this is where it is corrected.
       */}
      <div className="mt-5 rounded-lg border border-line bg-sunken/60 p-4">
        <div className="mb-1 text-sm font-semibold text-ink">{t('อัตราแปลงหน่วย')}</div>
        <p className="mb-3 text-xs text-ink-faint">
          {t('เช่น "1 Carton = 12 Pack", "1 Pack = 25 {unit}", "2.72 KG = 1 {unit}" — ระบบบันทึกสต๊อกเป็น {unit} จริงตามอัตราเหล่านี้ ประวัติเก่าคงอัตราที่บันทึกไว้ตอนนั้น', {
            unit: form.unitType || t('หน่วย'),
          })}
        </p>
        <ConversionRows
          baseUnit={form.unitType}
          rows={form.unitConversions ?? []}
          onChange={(rows) => setForm({ ...form, unitConversions: rows })}
          unitChoices={unitChoices}
          disabled={!canEdit}
        />
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
                <span className="flex-1 truncate text-sm text-ink-soft"><SiteChip locationId={l.id} /></span>
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
      <BarcodeScanner
        open={scanning}
        onClose={() => setScanning(false)}
        onRead={(code) => {
          setForm((f) => ({ ...f, barcode: code }))
          setScanning(false)
        }}
      />
    </Modal>
  )
}
