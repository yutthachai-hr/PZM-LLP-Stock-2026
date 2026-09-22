import { useEffect, useMemo, useRef, useState } from 'react'
import { SiteSelect } from '../components/SiteChip'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import {
  Button,
  Card,
  Field,
  FormActions,
  Input,
  Select,
  Textarea,
} from '../components/ui'
import { PageHero } from '../components/frame'
import { ProductThumb } from '../components/ProductThumb'
import { QtyInput } from '../components/QtyInput'
import { TodayTransactions, WithTodayPanel } from '../components/movements/TodayTransactions'
import { useEntryUnits } from '../services/entryUnits'
import { adjustStock } from '../services/stock'
import { deliver } from '../services/notifications'
import { useScheduleConfig } from '../services/schedules'
import { significance } from '../lib/inventoryRules/adjustments'
import { adjustmentDraft } from '../lib/inventoryRules/notifications'
import { dateInputToMs, fmtQty, msToDateInput, todayMs } from '../lib/format'
import { ADJUST_REASONS, type Product } from '../types'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import { looseMatch, looseScore } from '../lib/search'
import { describeQty, type QtyEntry } from '../lib/uom'
import { useViewport } from '../lib/viewport'
import { QtySheet } from '../components/QtySheet'
import { useDraft } from '../lib/useDraft'
import { DraftNotice } from '../components/DraftNotice'

/** Enough of the list that the item wanted is on it; the box scrolls past the first eight. */
const MAX_MATCHES = 40

export function AdjustPage() {
  const t = useT()
  const plainUnits = useEntryUnits()
  const { products, locations, qtyAt } = useData()
  const { user } = useAuth()
  const toast = useToast()
  const { settings } = useScheduleConfig()

  const active = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  const [locationId, setLocationId] = useState('')
  const [search, setSearch] = useState('')
  const [product, setProduct] = useState<Product | null>(null)
  const [direction, setDirection] = useState<'in' | 'out'>('out')
  // As keyed and as filed: `qty` is the product's own unit, `entryQty` what was typed in
  // `entryUnit` when that differs (lib/uom.ts).
  const [entry, setEntry] = useState<QtyEntry>({ qty: 0, entryQty: 0, factor: 1 })
  const qty = entry.qty
  const [reason, setReason] = useState<string>(ADJUST_REASONS[0].value)
  const [dateStr, setDateStr] = useState(msToDateInput(todayMs()))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // A phone keys how many, which way and why in one sheet (spec §3, 21 Sep 2026);
  // the inline row stays for tablets and desktops.
  const phone = useViewport() === 'phone'
  const [sheet, setSheet] = useState(false)

  // A half-keyed adjustment survives leaving the screen (lib/useDraft.ts). The product is
  // kept by id and looked up again, so a renamed product comes back under its new name.
  const draft = useMemo(
    () => ({ locationId, productId: product?.id ?? '', direction, entry, reason, dateStr, note }),
    [locationId, product, direction, entry, reason, dateStr, note],
  )
  const { restored, clear: clearDraft } = useDraft(
    'adjust',
    draft,
    (d) => {
      if (d.locationId) setLocationId(d.locationId)
      const p = products.find((x) => x.id === d.productId) ?? null
      setProduct(p)
      if (d.direction === 'in' || d.direction === 'out') setDirection(d.direction)
      if (d.entry && typeof d.entry.qty === 'number') setEntry(d.entry)
      if (d.reason) setReason(d.reason)
      if (d.dateStr) setDateStr(d.dateStr)
      setNote(d.note ?? '')
    },
    (d) => !d.productId && !d.note.trim() && !(d.entry.qty > 0),
  )
  function discardDraft() {
    setProduct(null)
    setEntry({ qty: 0, entryQty: 0, factor: 1 })
    setNote('')
    setSearch('')
    clearDraft()
  }

  useEffect(() => {
    if (!locationId && active[0]) setLocationId(active[0].id)
  }, [locationId, active])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return products
      // A hidden product is one nobody should be filing against any more. Unhide it in
      // สินค้าคงคลัง if it turns out they should.
      .filter((p) => p.active !== false)
      .filter((p) => looseMatch([p.name, p.sku], q))
      .sort((a, b) => looseScore([b.name, b.sku], q) - looseScore([a.name, a.sku], q))
      .slice(0, MAX_MATCHES)
  }, [search, products])
  const searchRef = useRef<HTMLInputElement>(null)

  const current = product ? qtyAt(locationId, product.id) : 0

  async function submit() {
    if (!locationId) return toast.error(t("เลือกคลัง"))
    if (!product) return toast.error(t("เลือกสินค้า"))
    if (!(qty > 0)) return toast.error(t("จำนวนต้องมากกว่า 0"))
    setBusy(true)
    try {
      const docNo = await adjustStock({
        productId: product.id,
        productName: product.name,
        unit: product.unitType,
        ...(entry.entryUnit ? { entryUnit: entry.entryUnit, entryQty: entry.entryQty } : {}),
        locationId,
        direction,
        qty,
        reason,
        date: dateInputToMs(dateStr),
        actor: { id: user!.id, name: user!.name },
        note: note.trim() || undefined,
      })
      toast.success(t('ปรับสต๊อกเรียบร้อย (เลขที่ {docNo})', { docNo }))
      // A large adjustment or waste is told to the managers now, not at the next job run.
      // `qty` is the product's own unit whatever was keyed, so the value is right either way.
      {
        const moved = { docNo, productId: product.id, productName: product.name, qty, unit: product.unitType, reason, byUserName: user!.name,
          ...(direction === 'out' ? { fromLocationId: locationId } : { toLocationId: locationId }) }
        const now = direction === 'out' ? current - qty : current + qty
        const sig = significance({ ...moved, id: docNo, type: 'adjust', date: Date.now(), byUserId: user!.id, createdAt: Date.now() }, product, now, settings)
        if (sig) void deliver(adjustmentDraft(moved, sig.kind, sig.value, (id) => locations.find((l) => l.id === id)?.name ?? ''), { id: user!.id })
      }
      setProduct(null)
      setEntry({ qty: 0, entryQty: 0, factor: 1 })
      setNote('')
      setSearch('')
      clearDraft()
      // The next adjustment starts in the search box, not with a reach for the mouse.
      setTimeout(() => searchRef.current?.focus(), 0)
    } catch (e) {
      toast.error(t("บันทึกไม่สำเร็จ:") + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHero
        icon="adjust"
        tone="warn"
        title={t("ปรับสต๊อก")}
        subtitle={t("แก้ไขยอดกรณีของหาย เสียหาย หมดอายุ หรือปรับตามการนับจริง")}
      />

      <WithTodayPanel panel={<TodayTransactions types={['adjust']} date={dateInputToMs(dateStr)} title={t('ปรับสต๊อกที่ทำวันนี้')} />}>
      {restored && <DraftNotice onDiscard={discardDraft} />}
      <Card className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Field label={t("คลัง/สาขา")} required>
            <SiteSelect value={locationId} onChange={setLocationId} locations={active} />
          </Field>
          <Field label={t("วันที่")} required>
            <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
        </div>

        <Field label={t("สินค้า")} required>
          {product ? (
            <div className="flex items-center gap-3 rounded-lg border border-line p-2">
              <ProductThumb productId={product.id} hasImage={product.hasImage} size={36} />
              <div className="flex-1">
                <div className="text-sm font-medium">{product.name}</div>
                <div className="text-xs text-ink-soft">
                  {t('คงเหลือปัจจุบัน')}: <span className="num">{fmtQty(current)}</span>{' '}
                  {product.unitType}
                </div>
              </div>
              <Button variant="ghost" onClick={() => setProduct(null)}>
                {t("เปลี่ยน")}
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Input
                ref={searchRef}
                placeholder={t("ค้นหาสินค้า")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matches[0]) {
                    e.preventDefault()
                    setProduct(matches[0])
                    setSearch('')
                    if (phone) setSheet(true)
                  }
                }}
                autoComplete="off"
                spellCheck={false}
              />
              {matches.length > 0 && (
                <div className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-line bg-surface shadow-lg">
                  {matches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setProduct(p)
                        setSearch('')
                        if (phone) setSheet(true)
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-sunken"
                    >
                      <ProductThumb productId={p.id} hasImage={p.hasImage} size={32} />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-ink-faint">{p.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>

        {phone && product && (
          <button
            type="button"
            onClick={() => setSheet(true)}
            className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-line px-3 text-left outline-none active:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <span className="text-sm text-ink-soft">
              {direction === 'out' ? t('ลดออก (−)') : t('เพิ่มเข้า (+)')} · {t(ADJUST_REASONS.find((r) => r.value === reason)?.label ?? reason)}
            </span>
            <span className="num shrink-0 text-base font-semibold text-ink">
              {entry.qty > 0
                ? describeQty({ qty: entry.qty, entryQty: entry.entryQty, entryUnit: entry.entryUnit, unit: product.unitType }, fmtQty)
                : t('ใส่จำนวน')}
            </span>
          </button>
        )}

        {!phone && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("ทิศทาง")} required>
            <Select
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'in' | 'out')}
            >
              <option value="out">{t("ลดออก (−)")}</option>
              <option value="in">{t("เพิ่มเข้า (+)")}</option>
            </Select>
          </Field>
          <Field label={t("จำนวน")} required>
            <QtyInput
              unitType={product?.unitType ?? ''}
              plainUnits={plainUnits}
              conversions={product?.unitConversions}
              value={qty}
              onChange={setEntry}
              product={product ?? undefined}
              onRateDefined={(list) => setProduct((p) => (p ? { ...p, unitConversions: list } : p))}
            />
          </Field>
          <Field label={t("เหตุผล")} required>
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {ADJUST_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {t(r.label)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        )}

        <Field label={t("หมายเหตุ (ไม่บังคับ)")}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {product && (
          <div className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink-soft">
            {t('คงเหลือหลังปรับ:')}{' '}
            <span className="num font-semibold text-ink">
              {fmtQty(direction === 'in' ? current + qty : current - qty)} {product.unitType}
            </span>
          </div>
        )}

        <FormActions>
          <Button onClick={submit} disabled={busy}>
            {busy ? t("กำลังบันทึก...") : t("บันทึกการปรับ")}
          </Button>
        </FormActions>
      </Card>
      </WithTodayPanel>
      {phone && (
        <QtySheet
          open={sheet && !!product}
          product={product}
          initial={entry.qty > 0 ? { qty: entry.qty, entryQty: entry.entryQty, entryUnit: entry.entryUnit } : undefined}
          available={direction === 'out' ? current : undefined}
          direction={direction}
          submitLabel={t('ตกลง')}
          extra={
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('ทิศทาง')}>
                <Select value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
                  <option value="out">{t('ลดออก (−)')}</option>
                  <option value="in">{t('เพิ่มเข้า (+)')}</option>
                </Select>
              </Field>
              <Field label={t('เหตุผล')}>
                <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                  {ADJUST_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {t(r.label)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          }
          onClose={() => setSheet(false)}
          onSubmit={(e) => {
            setEntry(e)
            setSheet(false)
          }}
          onRateDefined={(list) => setProduct((p) => (p ? { ...p, unitConversions: list } : p))}
        />
      )}
    </div>
  )
}
