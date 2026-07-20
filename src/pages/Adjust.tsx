import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Button, Card, Field, Input, Select, Textarea } from '../components/ui'
import { ProductThumb } from '../components/ProductThumb'
import { QtyInput } from '../components/QtyInput'
import { adjustStock } from '../services/stock'
import { dateInputToMs, fmtQty, msToDateInput, todayMs } from '../lib/format'
import { ADJUST_REASONS, type Product } from '../types'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'

export function AdjustPage() {
  const t = useT()
  const { products, locations, qtyAt } = useData()
  const { user } = useAuth()
  const toast = useToast()

  const active = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  const [locationId, setLocationId] = useState('')
  const [search, setSearch] = useState('')
  const [product, setProduct] = useState<Product | null>(null)
  const [direction, setDirection] = useState<'in' | 'out'>('out')
  const [qty, setQty] = useState(0)
  const [reason, setReason] = useState<string>(ADJUST_REASONS[0].value)
  const [dateStr, setDateStr] = useState(msToDateInput(todayMs()))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!locationId && active[0]) setLocationId(active[0].id)
  }, [locationId, active])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 8)
  }, [search, products])

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
        locationId,
        direction,
        qty,
        reason,
        date: dateInputToMs(dateStr),
        actor: { id: user!.id, name: user!.name },
        note: note.trim() || undefined,
      })
      toast.success(t('ปรับสต๊อกเรียบร้อย (เลขที่ {docNo})', { docNo }))
      setProduct(null)
      setQty(0)
      setNote('')
      setSearch('')
    } catch (e) {
      toast.error(t("บันทึกไม่สำเร็จ:") + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t("🔧 ปรับสต๊อก")}</h1>
        <p className="text-sm text-slate-500">{t("แก้ไขยอดกรณีของหาย เสียหาย หมดอายุ หรือปรับตามการนับจริง")}</p>
      </div>

      <Card className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("คลัง/สาขา")} required>
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {active.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("วันที่")} required>
            <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
        </div>

        <Field label={t("สินค้า")} required>
          {product ? (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-2">
              <ProductThumb productId={product.id} hasImage={product.hasImage} size={36} />
              <div className="flex-1">
                <div className="text-sm font-medium">{product.name}</div>
                <div className="text-xs text-slate-500">
                  {t('คงเหลือปัจจุบัน')}: {fmtQty(current)} {product.unitType}
                </div>
              </div>
              <Button variant="ghost" onClick={() => setProduct(null)}>
                {t("เปลี่ยน")}
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Input
                placeholder={t("🔍 ค้นหาสินค้า")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {matches.length > 0 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                  {matches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setProduct(p)
                        setSearch('')
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <ProductThumb productId={p.id} hasImage={p.hasImage} size={32} />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-slate-400">{p.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>

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
            <QtyInput unitType={product?.unitType ?? ''} value={qty} onChange={setQty} />
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

        <Field label={t("หมายเหตุ (ไม่บังคับ)")}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {product && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {t('คงเหลือหลังปรับ:')}{' '}
            <span className="font-semibold text-slate-800">
              {fmtQty(direction === 'in' ? current + qty : current - qty)} {product.unitType}
            </span>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={submit} disabled={busy}>
            {busy ? t("กำลังบันทึก...") : t("บันทึกการปรับ")}
          </Button>
        </div>
      </Card>
    </div>
  )
}
