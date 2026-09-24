import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { Icon } from '../../components/Icon'
import { SiteSelect } from '../../components/SiteChip'
import { AlertBanner, Button, Field, Input, Textarea } from '../../components/ui'
import { FramePage, PageHero, SectionCard } from '../../components/frame'
import { LineBuilder, type Line } from '../../components/LineBuilder'
import { SubmitBar } from '../../components/keying/SubmitBar'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { dateInputToMs, fmtQty, msToDateInput, todayMs } from '../../lib/format'
import { sourceFigures } from '../../lib/transferFigures'
import { canUserAccessBranch } from '../../lib/transferStatus'
import { createDraft, listOpenTransfers, saveItems, submitTransfer } from '../../services/transfers'
import type { Transfer, TransferItem } from '../../types'

interface TransferEditorProps {
  initial: Transfer | null
  onChange: (t: Transfer) => void
}

/**
 * The request: where from, where to, when, and what — built the way a receipt or a
 * purchase request is (LineBuilder: search by name, code or barcode, scan, key in any unit
 * the product has a rate for). A draft keeps its lines; a returned request comes back here
 * for the requester to change and send again.
 */
export function TransferEditor({ initial, onChange }: TransferEditorProps) {
  const t = useT()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const { products, productById, locations, qtyAt } = useData()

  const actor = useMemo(
    () => (user ? { id: user.id, name: user.name, role: user.role, siteIds: user.siteIds } : null),
    [user],
  )
  const sites = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  // A source the person works at; a manager or someone with no sites may pick any.
  const sources = useMemo(() => sites.filter((l) => canUserAccessBranch(actor ?? undefined, l.id)), [sites, actor])
  const defaultSource = sources.find((l) => l.type === 'warehouse') ?? sources[0]

  const [fromLocationId, setFromLocationId] = useState(initial?.fromLocationId ?? defaultSource?.id ?? '')
  const [toLocationId, setToLocationId] = useState(initial?.toLocationId ?? '')
  const [dateStr, setDateStr] = useState(msToDateInput(initial?.dispatchDate ?? todayMs()))
  const [note, setNote] = useState(initial?.note ?? '')
  const [lines, setLines] = useState<Line[]>(() =>
    (initial?.items ?? [])
      .filter((i) => !i.removed)
      .map((i) => ({
        productId: i.productId,
        productName: i.productName,
        unit: i.unit,
        qty: i.requestedQty ?? i.dispatchQty ?? 0,
        ...(i.requestedEntryUnit ? { entryUnit: i.requestedEntryUnit, entryQty: i.requestedEntryQty } : {}),
      })),
  )
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Transfer[]>([])

  // What other requests already ask of the source, and what is on the road — one bounded
  // read of the open documents, not a subscription.
  useEffect(() => {
    let live = true
    listOpenTransfers()
      .then((rows) => live && setOpen(rows))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!toLocationId && sites.length > 1) {
      const branch = sites.find((l) => l.type === 'branch' && l.id !== fromLocationId)
      if (branch) setToLocationId(branch.id)
    }
  }, [toLocationId, sites, fromLocationId])

  const availableAt = (productId: string) => qtyAt(fromLocationId, productId)

  function items(): TransferItem[] {
    return lines.map((l, idx) => ({
      idx,
      productId: l.productId,
      productName: l.productName,
      sku: productById(l.productId)?.sku ?? '',
      unit: l.unit,
      requestedQty: l.qty,
      dispatchQty: l.qty,
      ...(l.entryUnit && l.entryQty ? { requestedEntryUnit: l.entryUnit, requestedEntryQty: l.entryQty } : {}),
    }))
  }

  function routeOk(): boolean {
    if (!fromLocationId || !toLocationId) {
      toast.error(t('เลือกต้นทางและปลายทาง'))
      return false
    }
    if (fromLocationId === toLocationId) {
      toast.error(t('ต้นทางและปลายทางต้องต่างกัน'))
      return false
    }
    return true
  }

  /** The document, created on first save; its lines saved with it. */
  async function ensureDraft(): Promise<Transfer> {
    if (initial) return initial
    return createDraft({ fromLocationId, toLocationId, dispatchDate: dateInputToMs(dateStr), note: note.trim() || undefined, actor: actor! })
  }

  async function handleSaveDraft() {
    if (!actor || !routeOk()) return
    setBusy(true)
    try {
      const draft = await ensureDraft()
      const saved = lines.length ? await saveItems(draft.id, items(), actor, note) : draft
      toast.success(t('บันทึกร่างเรียบร้อย ({docNo})', { docNo: saved.docNo }))
      onChange(saved)
      navigate(`/transfers/${saved.id}`, { replace: true })
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit() {
    if (!actor || !routeOk()) return
    if (lines.length === 0) return toast.error(t('เพิ่มรายการสินค้าก่อน'))
    if (lines.some((l) => !(l.qty > 0))) return toast.error(t('จำนวนต้องมากกว่า 0'))
    setBusy(true)
    try {
      const draft = await ensureDraft()
      const submitted = await submitTransfer(draft.id, actor, items())
      toast.success(t('ส่งคำขอโอนสินค้าเรียบร้อย ({docNo})', { docNo: submitted.docNo }))
      onChange(submitted)
      navigate(`/transfers/${submitted.id}`, { replace: true })
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const figures = lines.map((l) => ({ line: l, f: sourceFigures(open, fromLocationId, l.productId, availableAt(l.productId), initial?.id) }))
  const short = figures.filter(({ line, f }) => line.qty > f.onHand)

  return (
    <FramePage>
      <PageHero
        icon="truck"
        tone="brand"
        title={initial ? t('แก้ไขคำขอโอน ({docNo})', { docNo: initial.docNo }) : t('สร้างคำขอโอนสินค้า')}
        subtitle={t('เลือกสาขาต้นทาง ปลายทาง และระบุสินค้าที่ต้องการโอน')}
      />

      {initial?.status === 'returned' && initial.returnReason && (
        <AlertBanner tone="warn">
          {t('หัวหน้าส่งกลับให้แก้ไข')}: {initial.returnReason}
        </AlertBanner>
      )}

      <div className="mx-auto max-w-4xl space-y-4">
        <SectionCard icon="note" title={t('ข้อมูลเส้นทางและกำหนดการ')}>
          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 md:gap-3">
              <Field label={t('จากคลัง / สาขา (ต้นทาง)')} required>
                <SiteSelect value={fromLocationId} onChange={setFromLocationId} locations={sources} />
              </Field>
              <span className="mb-1.5 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-sunken text-ink-soft md:h-9 md:w-9" aria-hidden>
                <Icon name="arrowRight" size={16} />
              </span>
              <Field label={t('ไปยังสาขา (ปลายทาง)')} required>
                <SiteSelect
                  value={toLocationId}
                  onChange={setToLocationId}
                  locations={sites.filter((l) => l.id !== fromLocationId)}
                  emptyLabel={t('— เลือก —')}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
              <Field label={t('วันที่ขนส่ง')} required>
                <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
              </Field>
              <Field label={t('ผู้ทำรายการ')}>
                <Input value={user?.name ?? ''} disabled />
              </Field>
              <Field label={t('หมายเหตุ')}>
                <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ระบุหมายเหตุ (ถ้ามี)')} />
              </Field>
            </div>
          </div>
        </SectionCard>

        <SectionCard icon="package" title={t('รายการสินค้าที่ต้องการโอน')} count={lines.length ? t('({n} รายการ)', { n: lines.length }) : undefined}>
          <LineBuilder products={products} lines={lines} onChange={setLines} availableAt={availableAt} direction="out" lineNotes={false} />
        </SectionCard>

        {lines.length > 0 && (
          <SectionCard icon="chart" title={t('สต๊อกที่ต้นทาง')}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-soft">
                  <tr>
                    <th className="py-1.5 pr-2">{t('สินค้า')}</th>
                    <th className="px-2 py-1.5 text-right">{t('คงเหลือ')}</th>
                    <th className="px-2 py-1.5 text-right">{t('ติดคำขอรออนุมัติอื่น')}</th>
                    <th className="px-2 py-1.5 text-right">{t('กำลังส่ง')}</th>
                    <th className="py-1.5 pl-2 text-right">{t('ขอครั้งนี้')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {figures.map(({ line, f }) => (
                    <tr key={line.productId}>
                      <td className="py-2 pr-2">{line.productName}</td>
                      <td className="num px-2 py-2 text-right">
                        {fmtQty(f.onHand)} <span className="text-xs text-ink-soft">{line.unit}</span>
                      </td>
                      <td className="num px-2 py-2 text-right text-ink-soft">{fmtQty(f.waitingApproval)}</td>
                      <td className="num px-2 py-2 text-right text-ink-soft">{fmtQty(f.onTheRoad)}</td>
                      <td className={`num py-2 pl-2 text-right font-semibold ${line.qty > f.onHand ? 'text-danger' : ''}`}>
                        {fmtQty(line.qty)}
                        {line.entryUnit && <span className="block text-xs font-normal text-ink-soft">{fmtQty(line.entryQty ?? 0)} {line.entryUnit}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              {t('คงเหลือ = ยอดที่ต้นทางตอนนี้ (หักของที่ส่งออกไปแล้ว) · คำขอที่รออนุมัติยังไม่ได้จองสต๊อก · หัวหน้าจะตรวจยอดล่าสุดอีกครั้งตอนอนุมัติ')}
            </p>
            {short.length > 0 && (
              <div className="mt-2">
                <AlertBanner tone="warn">{t('สต๊อกไม่พอสำหรับ "{name}"', { name: short[0].line.productName })}</AlertBanner>
              </div>
            )}
          </SectionCard>
        )}

        <SubmitBar hasDraft={lines.length > 0}>
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <Button variant="outline" onClick={handleSaveDraft} disabled={busy} className="w-full sm:w-auto">
              {t('บันทึกร่าง')}
            </Button>
            <Button onClick={handleSubmit} disabled={busy || lines.length === 0} className="w-full sm:w-auto sm:min-w-64">
              <Icon name="check" size={18} />
              {busy ? t('กำลังบันทึก...') : t('ส่งคำขอโอนสินค้า ({n} รายการ)', { n: lines.length })}
            </Button>
          </div>
        </SubmitBar>
      </div>
    </FramePage>
  )
}
