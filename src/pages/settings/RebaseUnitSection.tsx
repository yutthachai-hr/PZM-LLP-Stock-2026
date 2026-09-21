import { useMemo, useState } from 'react'
import { useConfirm } from '../../components/Confirm'
import { SiteChip } from '../../components/SiteChip'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, Field, Input, SectionHeader, SegTab, Select } from '../../components/ui'
import { useData } from '../../data/DataContext'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { fmtQty } from '../../lib/format'
import { looseMatch, looseScore } from '../../lib/search'
import { sameUnit } from '../../lib/units'
import { useEntryUnits } from '../../services/entryUnits'
import { previewRebase, rebaseProductUnit, type RebaseMode, type RebasePreview } from '../../services/unitRebase'
import type { Product } from '../../types'

/**
 * Settings → ดูแลข้อมูล: change a product's own unit when goods and history already exist.
 *
 * The product page can only relabel (75 KG → "75 Lot"), which is right for firewood and
 * wrong for cheese. This one recalculates: by rate ("1 EA = 2.72 KG") where a piece has a
 * known weight, by recount where it does not (Parma legs). It shows what every site will
 * come to before anything is written, asks for a physical count where the arithmetic does
 * not land on whole pieces, and never runs without the preview. Owner's rule, 21 Sep 2026:
 * nothing changes without being asked, product by product.
 */
export function RebaseUnitSection({ actor }: { actor: { id: string; name: string } }) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const { products } = useData()
  const plainUnits = useEntryUnits()

  const [query, setQuery] = useState('')
  const [product, setProduct] = useState<Product | null>(null)
  const [to, setTo] = useState('')
  const [mode, setMode] = useState<RebaseMode>('rate')
  const [factor, setFactor] = useState('')
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<RebasePreview | null>(null)
  const [busy, setBusy] = useState('')

  const matches = useMemo(() => {
    const q = query.trim()
    if (!q || product) return []
    return products
      .filter((p) => p.active !== false && looseMatch([p.name, p.sku], q))
      .sort((a, b) => looseScore([b.name, b.sku], q) - looseScore([a.name, a.sku], q))
      .slice(0, 8)
  }, [products, query, product])

  const unitChoices = useMemo(() => plainUnits.filter((u) => !product || !sameUnit(u, product.unitType)), [plainUnits, product])

  function pick(p: Product) {
    setProduct(p)
    setQuery(`${p.sku} · ${p.name}`)
    setTo('')
    setFactor('')
    setCounts({})
    setPreview(null)
  }

  function reset() {
    setProduct(null)
    setQuery('')
    setTo('')
    setFactor('')
    setCounts({})
    setPreview(null)
  }

  const factorNum = Number(factor)

  async function runPreview() {
    if (!product) return
    setBusy('preview')
    try {
      const p = await previewRebase({ productId: product.id, to, mode, ...(mode === 'rate' ? { factor: factorNum } : {}) })
      setPreview(p)
      // The boxes start empty: a whole conversion stands unless overridden, everything
      // else has to be typed by the person who counted it.
      setCounts({})
    } catch (e) {
      setPreview(null)
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  async function run() {
    if (!product || !preview) return
    const parsed: Record<string, number> = {}
    for (const [loc, v] of Object.entries(counts)) {
      if (v.trim() === '') continue
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) return toast.error(t('จำนวนนับต้องเป็นตัวเลขไม่ติดลบ'))
      parsed[loc] = n
    }
    const lines = preview.sites.map((s) => {
      const final = parsed[s.locationId] ?? s.suggested
      return `${s.locationName}: ${fmtQty(s.oldQty)} ${preview.from} → ${fmtQty(final)} ${preview.to}`
    })
    const ok = await confirm({
      title: t('เปลี่ยนหน่วยหลักของ {name} เป็น {unit}', { name: product.name, unit: preview.to }),
      message:
        t('จะเขียนประวัติ {n} รายการใหม่ในหน่วย {unit} (ตัวเลขที่คีย์ไว้เดิมยังอ่านได้ทุกรายการ) และตั้งยอดคงเหลือตามนี้', { n: preview.movements, unit: preview.to }) +
        '\n\n' +
        lines.join('\n') +
        (preview.openOrders.length ? '\n\n' + t('ใบสั่งซื้อที่เปิดอยู่จะถูกแก้เป็นหน่วยใหม่ (บันทึกเป็น Revision): {list}', { list: preview.openOrders.map((o) => o.docNo).join(', ') }) : ''),
      confirmText: t('เปลี่ยนหน่วย'),
    })
    if (!ok) return
    setBusy('run')
    try {
      const r = await rebaseProductUnit({ productId: product.id, to: preview.to, mode, ...(mode === 'rate' ? { factor: factorNum } : {}), counts: parsed, actor })
      toast.success(t('เปลี่ยนหน่วยแล้ว — ประวัติ {n} รายการ, นับจริง {c} สาขา', { n: r.movements, c: r.counted }))
      reset()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  return (
    <Card className="p-4">
      <SectionHeader
        icon="adjust"
        title={t('เปลี่ยนหน่วยหลักพร้อมคำนวณ')}
        description={t('สำหรับสินค้าที่มียอดและประวัติแล้ว เช่น เคยนับเป็น KG แต่จะเปลี่ยนมานับเป็นชิ้น — ระบบคำนวณตามอัตราที่ระบุ หรือให้นับจริงใหม่ถ้าน้ำหนักต่อชิ้นไม่คงที่ ตัวเลขเดิมยังอ่านได้ทุกรายการ และจะแสดงผลลัพธ์ให้ดูก่อนยืนยันเสมอ')}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('สินค้า')} className="relative sm:col-span-2">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                if (product) {
                  setProduct(null)
                  setPreview(null)
                }
              }}
              placeholder={t('พิมพ์ชื่อหรือรหัสสินค้า')}
              disabled={!!busy}
            />
            {product && (
              <Button variant="ghost" onClick={reset} disabled={!!busy}>
                {t('ล้าง')}
              </Button>
            )}
          </div>
          {matches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">
              {matches.map((p) => (
                <button key={p.id} type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-sunken" onClick={() => pick(p)}>
                  <span className="truncate">
                    <span className="text-ink-faint">{p.sku}</span> {p.name}
                  </span>
                  <Badge>{p.unitType}</Badge>
                </button>
              ))}
            </div>
          )}
        </Field>
        {product && (
          <>
            <Field label={t('หน่วยใหม่ (ตอนนี้: {unit})', { unit: product.unitType })} required>
              <Select value={to} onChange={(e) => { setTo(e.target.value); setPreview(null) }} disabled={!!busy}>
                <option value="">{t('— เลือกหน่วย —')}</option>
                {unitChoices.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('วิธีคิดยอด')} required>
              <div className="flex gap-1 rounded-lg bg-sunken p-1">
                <SegTab label={t('ตามอัตรา')} active={mode === 'rate'} onClick={() => { setMode('rate'); setPreview(null) }} />
                <SegTab label={t('นับจริงใหม่')} active={mode === 'recount'} onClick={() => { setMode('recount'); setPreview(null) }} />
              </div>
            </Field>
            {mode === 'rate' ? (
              <Field label={t('อัตรา: 1 {to} = กี่ {from}', { to: to || '?', from: product.unitType })} required hint={t('เช่น มอสซาเรลล่า 1 EA = 2.72 KG — ประวัติทุกรายการจะคิดด้วยอัตรานี้')}>
                <Input type="number" inputMode="decimal" min={0} step="any" value={factor} onChange={(e) => { setFactor(e.target.value); setPreview(null) }} disabled={!!busy} />
              </Field>
            ) : (
              <div className="rounded-lg bg-sunken p-3 text-xs leading-relaxed text-ink-soft sm:col-span-2">
                {t('ใช้เมื่อแปลงด้วยอัตราไม่ได้ (เช่น ขาหมูแต่ละขาน้ำหนักไม่เท่ากัน): ยอด {from} เดิมจะถูกปิดด้วยรายการปรับที่ลงชื่อไว้ และยอดใหม่คือจำนวนที่คุณนับจริงแต่ละสาขา ต้องไม่มีใบสั่งซื้อของสินค้านี้ค้างอยู่', { from: product.unitType })}
              </div>
            )}
            <div className="flex items-end sm:col-span-2">
              <Button variant="secondary" onClick={() => void runPreview()} disabled={!!busy || !to || (mode === 'rate' && !(factorNum > 0))}>
                {busy === 'preview' ? t('กำลังคำนวณ...') : t('ดูผลลัพธ์ก่อน')}
              </Button>
            </div>
          </>
        )}
      </div>

      {preview && product && (
        <div className="mt-4 space-y-3">
          <div className="text-sm text-ink">
            {t('ประวัติที่จะเขียนใหม่: {n} รายการ', { n: preview.movements })}
            {preview.openOrders.length > 0 && (
              <span className="ml-2">
                <Badge color={mode === 'recount' ? 'red' : 'amber'}>
                  {t('ใบสั่งซื้อเปิดอยู่: {list}', { list: preview.openOrders.map((o) => o.docNo).join(', ') })}
                </Badge>
              </span>
            )}
          </div>
          {preview.conversions.length > 0 && (
            <div className="text-xs text-ink-soft">
              {t('อัตราของสินค้าหลังเปลี่ยน')}: {preview.conversions.map((c) => `${fmtQty(c.per ?? 1)} ${c.label} = ${fmtQty(c.size)} ${c.of ?? preview.to}`).join(' · ')}
            </div>
          )}
          {preview.sites.length === 0 ? (
            <div className="text-sm text-ink-faint">{t('ไม่มียอดคงเหลือที่สาขาใด — เปลี่ยนได้ทันที')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-soft">
                  <tr>
                    <th className="py-1 pr-3">{t('สาขา')}</th>
                    <th className="py-1 pr-3 text-right">{t('ยอดเดิม')}</th>
                    <th className="py-1 pr-3 text-right">{mode === 'rate' ? t('คำนวณได้') : t('รายการนับชิ้นที่มีอยู่')}</th>
                    <th className="py-1 pr-3">{t('จำนวนนับจริง ({unit})', { unit: preview.to })}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sites.map((s) => {
                    const need = mode === 'recount' || !s.whole
                    return (
                      <tr key={s.locationId} className="border-t border-line">
                        <td className="py-2 pr-3"><SiteChip locationId={s.locationId} /></td>
                        <td className="num py-2 pr-3 text-right">{fmtQty(s.oldQty)} {preview.from}</td>
                        <td className="num py-2 pr-3 text-right">
                          {fmtQty(s.suggested)} {preview.to}
                          {!s.whole && <Badge color="amber">{t('ไม่เต็มหน่วย')}</Badge>}
                        </td>
                        <td className="py-2 pr-3">
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="any"
                            className="w-32"
                            value={counts[s.locationId] ?? ''}
                            onChange={(e) => setCounts((c) => ({ ...c, [s.locationId]: e.target.value }))}
                            placeholder={need ? t('ต้องระบุ') : fmtQty(s.suggested)}
                            disabled={!!busy}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-xs text-ink-soft">
            {mode === 'rate'
              ? t('ช่องนับจริงเว้นว่างได้ถ้ายอดที่คำนวณได้ถูกต้อง; ที่ไม่เต็มหน่วยต้องระบุ — ส่วนต่างบันทึกเป็นรายการปรับสต๊อก (นับจริง) ตรวจสอบย้อนหลังได้')
              : t('ต้องระบุจำนวนนับจริงทุกสาขา — ส่วนต่างจากรายการนับชิ้นที่มีอยู่บันทึกเป็นรายการปรับสต๊อก')}
          </div>
          <Button onClick={() => void run()} disabled={!!busy || (mode === 'recount' && preview.openOrders.length > 0)}>
            {busy === 'run' ? t('กำลังเปลี่ยน...') : t('ยืนยันเปลี่ยนหน่วย')}
          </Button>
        </div>
      )}
    </Card>
  )
}
