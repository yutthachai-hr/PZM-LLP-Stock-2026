import { useCallback, useEffect, useMemo, useState } from 'react'
import { siteTones } from '../../lib/siteTone'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { RESUME_PARAM } from '../../share/liffResume'
import { useAuth } from '../../auth/AuthContext'
import { useBrand } from '../../brand/BrandContext'
import { brandDef } from '../../brand/brand'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { Icon } from '../../components/Icon'
import { Badge, Button, Card, Field, Input, Modal, SectionHeader, SegTab, Select } from '../../components/ui'
import { PageHero } from '../../components/frame'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { dateInputToMs, fmtQty, formatThaiDate, formatThaiDateTime, msToDateInput } from '../../lib/format'
import { isManager, isReadyForOrder, isUnderReview, liveItems, PR_STATUS_KEYS, prBadgeColor } from '../../lib/purchaseRequestStatus'
import { exportRequestExcel, exportRequestPdf, groupedBySupplier } from '../../lib/requestExport'
import * as S from '../../services/purchaseRequests'
import { UrgencyChip, UrgencySelect } from './Urgency'
import { getPurchaseOrder } from '../../services/purchaseOrders'
import { useSuppliers } from '../../services/suppliers'
import { URGENCIES, type PurchaseOrder, type PurchaseRequest, type PurchaseRequestItem, type RequestUrgency, type Role } from '../../types'
import { SendWizard } from '../purchase/SendWizard'
import { ProductPicker, type PickedLine } from './ProductPicker'
import { ReasonModal } from './ReasonModal'

/**
 * The request after it leaves the requester's hands: what the หัวหน้า sees, decides and
 * signs; then the file it becomes and the orders it turns into.
 *
 * The approved quantity is typed straight into the row. The requested one stays beside
 * it, read-only, whoever is looking — that pair is the audit. Everything a manager does
 * here lands in the history tab with the old and new value.
 */
export function RequestReview({ initial, onChange }: { initial: PurchaseRequest; onChange: (pr: PurchaseRequest) => void }) {
  const t = useT()
  // Urgency is stored as a code; the history shows its word.
  const shownValue = (action: string, v: string) =>
    action === 'urgencyChanged' ? t(URGENCIES.find((u) => u.value === v)?.label ?? v) : v
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { brand } = useBrand()
  const { products, locations, locationById, qtyAt } = useData()
  const activeLocations = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  const tones = useMemo(() => siteTones(activeLocations), [activeLocations])
  const suppliers = useSuppliers()

  const [pr, setPrState] = useState(initial)
  const setPr = useCallback(
    (next: PurchaseRequest) => {
      setPrState(next)
      onChange(next)
    },
    [onChange],
  )
  const [tab, setTab] = useState<'items' | 'history'>('items')
  const [busy, setBusy] = useState('')
  const [ask, setAsk] = useState<null | 'return' | 'reject' | 'approve' | 'reopen' | { remove: PurchaseRequestItem }>(null)
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [sending, setSending] = useState(false)
  // Back from LINE Login: ?send=<orderId> reopens the wizard (share/liffResume.ts).
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const send = params.get(RESUME_PARAM)
    if (!send || orders.length === 0) return
    if (orders.some((o) => o.id === send)) setSending(true)
    setParams({}, { replace: true })
  }, [params, setParams, orders])
  const [converting, setConverting] = useState(false)

  const actor = useMemo(() => (user ? { id: user.id, name: user.name, role: user.role as Role } : null), [user])
  const manager = isManager(user?.role)
  const reviewing = isUnderReview(pr.status) && manager
  const company = brand ? brandDef(brand).name : ''
  const locationName = locationById(pr.locationId)?.name ?? ''
  const groups = useMemo(() => groupedBySupplier(pr), [pr])
  const live = useMemo(() => liveItems(pr.items), [pr])
  const inCart = useMemo(() => new Set(live.map((i) => i.productId)), [live])
  const ctx = useMemo(() => ({ products, suppliers, locations }), [products, suppliers, locations])

  // The orders this request became, for the LINE wizard and the "sent" badges.
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!pr.orders?.length) return
      const loaded = await Promise.all(pr.orders.map((o) => getPurchaseOrder(o.poId)))
      if (alive) setOrders(loaded.filter((o): o is PurchaseOrder => !!o))
    })()
    return () => {
      alive = false
    }
  }, [pr.orders])

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label)
    try {
      return await fn()
    } catch (e) {
      toast.error(errText(e, t))
      return undefined
    } finally {
      setBusy('')
    }
  }

  async function setApproved(item: PurchaseRequestItem, qty: number) {
    if (!actor || !(qty > 0) || qty === item.approvedQty) return
    await run(`appr-${item.idx}`, async () => setPr(await S.setApprovedQty({ id: pr.id, idx: item.idx, qty, actor })))
  }
  async function setNote(item: PurchaseRequestItem, note: string) {
    if (!actor || note === (item.note ?? '')) return
    await run(`note-${item.idx}`, async () => setPr(await S.setItemNote({ id: pr.id, idx: item.idx, note, actor })))
  }
  async function setUrgency(item: PurchaseRequestItem, urgency: RequestUrgency) {
    if (!actor) return
    await run(`urg-${item.idx}`, async () => setPr(await S.setItemUrgency({ id: pr.id, idx: item.idx, urgency, actor })))
  }

  async function changeSupplier(item: PurchaseRequestItem, supplierId: string) {
    if (!actor || !supplierId || supplierId === item.supplierId) return
    await run(`sup-${item.idx}`, async () => setPr(await S.changeSupplier({ id: pr.id, idx: item.idx, supplierId, products, suppliers, actor })))
  }
  async function addLine(line: PickedLine) {
    if (!actor) return
    await run('add', async () => {
      setPr(await S.addItem({ id: pr.id, line, products, suppliers, actor }))
      toast.success(t('เพิ่ม {name} แล้ว', { name: line.productName }))
    })
  }
  async function convert(expectedAt: Record<string, number>) {
    if (!actor) return
    await run('convert', async () => {
      const next = await S.convertToOrders({ id: pr.id, products, actor, expectedAt })
      setPr(next)
      setConverting(false)
      toast.success(t('สร้างใบสั่งซื้อแล้ว {n} ใบ', { n: next.orders?.length ?? 0 }))
    })
  }
  async function exportFile(kind: 'pdf' | 'excel') {
    if (!actor) return
    await run(kind, async () => {
      if (kind === 'pdf') exportRequestPdf(pr, company, locationName, t)
      else exportRequestExcel(pr, locationName, t, (id) => locationById(id)?.name ?? id)
      setPr(await S.noteExport(pr.id, kind, actor))
    })
  }

  const supplierOptions = (item: PurchaseRequestItem) => {
    const p = products.find((x) => x.id === item.productId)
    const listed = p ? [p.supplierId, ...(p.alternateSupplierIds ?? [])].filter(Boolean) : []
    return suppliers
      .filter((s) => s.active !== false || s.id === item.supplierId)
      .map((s) => ({ s, listed: listed.includes(s.id), primary: p?.supplierId === s.id }))
      .sort((a, b) => Number(b.listed) - Number(a.listed) || a.s.name.localeCompare(b.s.name))
  }

  const unsent = orders.filter((o) => o.shareStatus !== 'sent' && o.shareStatus !== 'skipped')

  return (
    <div className="space-y-4">
      <PageHero
        icon="note"
        title={t('รายการขอสั่งซื้อ {docNo}', { docNo: pr.docNo })}
        subtitle={`${formatThaiDate(pr.createdAt)} · ${locationName} · ${t('ผู้ขอ')}: ${pr.requestedByName}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={prBadgeColor(pr.status)}>{t(PR_STATUS_KEYS[pr.status])}</Badge>
            {pr.revision > 1 && <Badge>{t('ครั้งที่ {n}', { n: pr.revision })}</Badge>}
            <Button variant="secondary" onClick={() => navigate('/requests')}>
              {t('รายการทั้งหมด')}
            </Button>
          </div>
        }
      />

      {pr.status === 'returned' && pr.returnReason && (
        <Card className="border-warn bg-warn-soft p-3 text-sm text-ink">{t('ส่งกลับให้แก้ไข: {reason}', { reason: pr.returnReason })}</Card>
      )}
      {pr.status === 'rejected' && (
        <Card className="border-danger bg-danger-soft p-3 text-sm text-ink">
          {t('ไม่อนุมัติโดย {name} — {reason}', { name: pr.rejectedByName ?? '', reason: pr.rejectReason ?? '' })}
        </Card>
      )}
      {(pr.status === 'approved' || pr.status === 'poCreated') && (
        <Card className="border-in bg-in-soft p-3 text-sm text-ink">
          {t('อนุมัติโดย {name} เมื่อ {date}', { name: pr.approvedByName ?? '', date: pr.approvedAt ? formatThaiDateTime(pr.approvedAt) : '' })}
          {pr.approvalNote ? ` — ${pr.approvalNote}` : ''}
        </Card>
      )}
      {pr.note && (
        <Card className="p-3 text-sm text-ink-soft">
          {t('หมายเหตุจากผู้ขอ')}: {pr.note}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('ผู้ขาย')} value={groups.length} />
        <Stat label={t('รายการ')} value={live.length} />
        <Stat label={t('ขอทั้งหมด')} value={live.reduce((n, i) => n + (i.requestedQty ?? 0), 0)} />
        <Stat label={t('อนุมัติทั้งหมด')} value={live.reduce((n, i) => n + (i.approvedQty ?? 0), 0)} tone="in" />
      </div>

      <div className="flex gap-1 rounded-lg bg-sunken p-1 sm:w-80">
        <SegTab label={t('รายการ')} active={tab === 'items'} onClick={() => setTab('items')} />
        <SegTab label={t('ประวัติ ({n})', { n: pr.history.length })} active={tab === 'history'} onClick={() => setTab('history')} />
      </div>

      {tab === 'items' ? (
        <>
          {groups.map((g) => (
            <Card key={g.supplierName} className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-line bg-sunken px-4 py-2">
                <span className="font-semibold text-ink">{g.supplierName}</span>
                <span className="text-xs text-ink-soft">{t('{count} รายการ', { count: g.items.length })}</span>
              </div>
              <div className="overflow-x-auto">
                <table className={`w-full table-fixed text-sm ${reviewing ? 'min-w-[1080px]' : 'min-w-[720px]'}`}>
                  {/* One table per supplier, so the widths are pinned here or every table
                      sizes its own columns and the numbers zigzag down the page. */}
                  <colgroup>
                    <col />
                    <col className="w-28" />
                    <col className="w-20" />
                    <col className={reviewing ? 'w-32' : 'w-20'} />
                    <col className="w-20" />
                    {reviewing && <col className="w-48" />}
                    <col className={reviewing ? 'w-48' : 'w-40'} />
                    {reviewing && <col className="w-24" />}
                  </colgroup>
                  <thead className="text-left text-xs text-ink-soft">
                    <tr>
                      <th className="px-4 py-2">{t('สินค้า')}</th>
                      <th className="px-2 py-2 text-right">{t('คงเหลือ')}</th>
                      <th className="px-2 py-2 text-right">{t('ขอ')}</th>
                      <th className="px-2 py-2 text-right">{t('อนุมัติ')}</th>
                      <th className="px-2 py-2">{t('หน่วย')}</th>
                      {reviewing && <th className="px-2 py-2">{t('ผู้ขาย')}</th>}
                      <th className="px-2 py-2">{t('หมายเหตุ')}</th>
                      {reviewing && <th className="px-2 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((item) => (
                      <tr key={item.idx} className="border-t border-line align-top">
                        <td className="px-4 py-2">
                          <div className="break-words text-ink">{item.productName}</div>
                          <div className="flex flex-wrap gap-2 text-xs text-ink-faint">
                            <span className="doc-no">{item.sku}</span>
                            {item.managerAdded && <Badge color="blue">{t('หัวหน้าเพิ่ม')}</Badge>}
                            {item.supplierChoice === 'custom' && <Badge color="amber">{t('เลือกผู้ขายเอง')}</Badge>}
                            {item.supplierChoice === 'alternate' && <Badge>{t('ผู้ขายสำรอง')}</Badge>}
                            {!reviewing && (item.urgency ?? 'normal') !== 'normal' && <UrgencyChip value={item.urgency} />}
                          </div>
                          {reviewing && (
                            <div className="mt-1.5">
                              <UrgencySelect
                                value={item.urgency}
                                onChange={(u) => void setUrgency(item, u)}
                                disabled={!!busy}
                                label={t('ความเร่งด่วนของ "{name}"', { name: item.productName })}
                              />
                            </div>
                          )}
                        </td>
                        {/* What was on the shelf when this was sent for review — at the
                            request's warehouse, then one tinted chip per site (the owner's
                            colours: see lib/siteTone.ts). No all-sites total: the chips are
                            the breakdown. A draft shows the live balance instead, marked so. */}
                        <td className="num px-2 py-2 text-right">
                          {(() => {
                            const live = item.stockAtSubmit === undefined
                            const here = live ? qtyAt(pr.locationId, item.productId) : item.stockAtSubmit
                            // Per location: the frozen figures when they exist, else live.
                            const perLoc = activeLocations
                              .map((l) => ({
                                l,
                                qty: live ? qtyAt(l.id, item.productId) : item.stockByLocationAtSubmit?.[l.id],
                              }))
                              .filter((x) => x.qty !== undefined)
                            return (
                              <>
                                <span className={`font-semibold ${here !== undefined && here <= 0 ? 'text-out' : 'text-ink'}`}>
                                  {here === undefined ? '—' : fmtQty(here)}
                                </span>
                                {perLoc.length > 0 && (
                                  <span className="mt-1 flex flex-col items-end gap-0.5">
                                    {perLoc.map((x) => (
                                      <span
                                        key={x.l.id}
                                        className={`inline-flex min-w-[8.5rem] justify-between gap-2 rounded px-1.5 text-[11px] leading-5 ${tones.get(x.l.id) ?? ''} ${(x.qty ?? 0) <= 0 ? 'opacity-60' : ''}`}
                                      >
                                        <span className="truncate">{x.l.name}</span>
                                        <span className="font-semibold">{fmtQty(x.qty ?? 0)}</span>
                                      </span>
                                    ))}
                                  </span>
                                )}
                                {live && <span className="block text-[10px] text-ink-faint">{t('ปัจจุบัน')}</span>}
                              </>
                            )
                          })()}
                        </td>
                        <td className="num px-2 py-2 text-right text-ink-soft">{item.requestedQty === null ? '—' : fmtQty(item.requestedQty)}</td>
                        <td className="px-2 py-2 text-right">
                          {reviewing ? (
                            <div className="ml-auto w-24">
                              <Input
                                key={`${item.idx}:${item.approvedQty ?? ''}`}
                                type="number"
                                min={0}
                                step="any"
                                inputMode="decimal"
                                defaultValue={item.approvedQty ?? ''}
                                onBlur={(e) => void setApproved(item, Number(e.target.value))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                }}
                                className="text-right"
                                aria-label={t('จำนวนที่อนุมัติ')}
                              />
                            </div>
                          ) : (
                            <span
                              className={`num font-semibold ${item.requestedQty !== null && item.approvedQty !== item.requestedQty ? 'text-warn' : 'text-ink'}`}
                            >
                              {item.approvedQty === undefined ? '—' : fmtQty(item.approvedQty)}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-ink-soft">{item.entryUnit ?? item.unit}</td>
                        {reviewing && (
                          <td className="px-2 py-2">
                            <div className="w-40">
                              <Select value={item.supplierId} onChange={(e) => void changeSupplier(item, e.target.value)} aria-label={t('ผู้ขาย')}>
                                {supplierOptions(item).map(({ s, listed, primary }) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                    {primary ? ` (${t('ผู้ขายประจำ')})` : listed ? ` (${t('สำรอง')})` : ''}
                                  </option>
                                ))}
                              </Select>
                            </div>
                          </td>
                        )}
                        <td className="px-2 py-2">
                          {reviewing ? (
                            <div className="w-40">
                              <Input defaultValue={item.note ?? ''} onBlur={(e) => void setNote(item, e.target.value)} placeholder={t('หมายเหตุ')} />
                            </div>
                          ) : (
                            <span className="text-xs text-ink-soft">{item.note ?? ''}</span>
                          )}
                        </td>
                        {reviewing && (
                          <td className="px-2 py-2">
                            <button type="button" onClick={() => setAsk({ remove: item })} className="text-xs text-danger" disabled={!!busy}>
                              {t('นำออก')}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}

          {pr.items.some((i) => i.removed) && (
            <Card className="p-4">
              <SectionHeader icon="eyeOff" title={t('รายการที่หัวหน้านำออก')} />
              <ul className="divide-y divide-line text-sm">
                {pr.items
                  .filter((i) => i.removed)
                  .map((i) => (
                    <li key={i.idx} className="flex flex-wrap gap-2 py-1.5 text-ink-soft">
                      <span className="line-through">{i.productName}</span>
                      <span className="num">{i.requestedQty === null ? '' : fmtQty(i.requestedQty)} {i.entryUnit ?? i.unit}</span>
                      <span className="text-xs">
                        — {i.removed!.byName}: {i.removed!.reason}
                      </span>
                    </li>
                  ))}
              </ul>
            </Card>
          )}

          {reviewing && (
            <Card className="p-4">
              <SectionHeader icon="plus" title={t('เพิ่มสินค้าให้รายการนี้')} description={t('รายการที่หัวหน้าเพิ่มจะไม่มีจำนวนที่ขอ มีแต่จำนวนที่อนุมัติ')} />
              <ProductPicker products={products} suppliers={suppliers} onAdd={addLine} inCart={inCart} />
            </Card>
          )}

          {/* ---- decisions ---- */}
          {pr.status !== 'draft' && (
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {reviewing && (
                  <>
                    <Button variant="danger" onClick={() => setAsk('reject')} disabled={!!busy}>
                      {t('ไม่อนุมัติ')}
                    </Button>
                    <Button variant="secondary" onClick={() => setAsk('return')} disabled={!!busy}>
                      {t('ส่งกลับให้แก้ไข')}
                    </Button>
                    <Button variant="success" onClick={() => setAsk('approve')} disabled={!!busy || live.length === 0}>
                      <Icon name="check" size={16} />
                      {t('อนุมัติทั้งหมด')}
                    </Button>
                  </>
                )}
                {/* A sheet of the request as it stands, at any stage — the manager takes
                    the pending one to the phone or the printer while deciding. */}
                {(
                  <>
                    <Button variant="secondary" onClick={() => void exportFile('pdf')} disabled={!!busy}>
                      <Icon name="download" size={16} />
                      PDF
                    </Button>
                    <Button variant="secondary" onClick={() => void exportFile('excel')} disabled={!!busy}>
                      <Icon name="download" size={16} />
                      Excel
                    </Button>
                  </>
                )}
                {isReadyForOrder(pr) && (
                  <Button onClick={() => setConverting(true)} disabled={!!busy || groups.length === 0}>
                    <Icon name="truck" size={16} />
                    {busy === 'convert' ? t('กำลังสร้าง...') : t('สร้างใบสั่งซื้อ')}
                  </Button>
                )}
                {(pr.status === 'approved' || pr.status === 'rejected') && user?.role === 'admin' && (
                  <Button variant="ghost" onClick={() => setAsk('reopen')} disabled={!!busy}>
                    {t('เปิดตรวจใหม่ (ผู้ดูแล)')}
                  </Button>
                )}
              </div>
            </Card>
          )}

          {pr.status === 'poCreated' && pr.orders && (
            <Card className="p-4">
              <SectionHeader
                icon="truck"
                title={t('สร้างใบสั่งซื้อแล้ว')}
                actions={
                  orders.length > 0 ? (
                    <Button onClick={() => setSending(true)}>
                      <Icon name="share" size={16} />
                      {unsent.length > 0 ? t('ส่ง LINE ทั้งหมด ({n})', { n: unsent.length }) : t('ดูสรุปการส่ง')}
                    </Button>
                  ) : undefined
                }
              />
              <ul className="divide-y divide-line text-sm">
                {pr.orders.map((o) => {
                  const live = orders.find((x) => x.id === o.poId)
                  return (
                    <li key={o.poId} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="flex-1 font-medium text-ink">{o.supplierName}</span>
                      <span className="doc-no text-ink-soft">→ {o.docNo}</span>
                      {live?.shareStatus === 'sent' && <Badge color="green">{t('ส่งเข้า LINE แล้ว')}</Badge>}
                      {live?.shareStatus === 'skipped' && <Badge>{t('ข้ามการส่ง')}</Badge>}
                      <button type="button" className="text-xs text-brand" onClick={() => navigate('/orders')}>
                        {t('ดูในหน้าสั่งซื้อ')}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}
        </>
      ) : (
        <Card className="p-4">
          <ol className="space-y-2 text-sm">
            {[...pr.history].reverse().map((h, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-28 shrink-0 text-xs text-ink-faint">{formatThaiDateTime(h.at)}</span>
                <div className="min-w-0">
                  <span className="font-medium text-ink">{h.byName}</span>{' '}
                  <span className="text-ink-soft">{historyText(h.action, t)}</span>
                  {h.detail && <span className="text-ink-soft"> — {h.detail}</span>}
                  {(h.oldValue !== undefined || h.newValue !== undefined) && (
                    <div className="text-xs text-ink-faint">
                      {h.oldValue !== undefined && h.oldValue !== '' ? `${shownValue(h.action, h.oldValue)} → ` : ''}
                      {shownValue(h.action, h.newValue ?? '')}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {ask === 'return' && (
        <ReasonModal
          title={t('ส่งกลับให้แก้ไข')}
          message={t('ผู้ขอจะแก้ไขรายการแล้วส่งมาใหม่ได้')}
          confirmText={t('ส่งกลับ')}
          onClose={() => setAsk(null)}
          onConfirm={async (reason) => {
            if (!actor) return
            await run('return', async () => setPr(await S.returnRequest({ id: pr.id, reason, actor })))
            setAsk(null)
          }}
        />
      )}
      {ask === 'reject' && (
        <ReasonModal
          title={t('ไม่อนุมัติ')}
          message={t('รายการนี้จะปิด ผู้ขอต้องสร้างรายการใหม่ถ้าจำเป็น')}
          confirmText={t('ไม่อนุมัติ')}
          danger
          onClose={() => setAsk(null)}
          onConfirm={async (reason) => {
            if (!actor) return
            await run('reject', async () => setPr(await S.rejectRequest({ id: pr.id, reason, actor })))
            setAsk(null)
          }}
        />
      )}
      {ask === 'approve' && (
        <ReasonModal
          title={t('อนุมัติทั้งหมด')}
          message={t('อนุมัติ {n} รายการจาก {s} ผู้ขาย ตามจำนวนที่อนุมัติในตาราง หลังจากนี้แก้ไขไม่ได้', { n: live.length, s: groups.length })}
          confirmText={t('อนุมัติ')}
          required={false}
          onClose={() => setAsk(null)}
          onConfirm={async (note) => {
            if (!actor) return
            const next = await run('approve', async () => S.approveRequest({ id: pr.id, note, ctx, actor }))
            if (next) {
              setPr(next)
              toast.success(t('อนุมัติแล้ว'))
              setAsk(null)
            }
          }}
        />
      )}
      {ask === 'reopen' && (
        <ReasonModal
          title={t('เปิดตรวจใหม่')}
          confirmText={t('เปิดตรวจใหม่')}
          onClose={() => setAsk(null)}
          onConfirm={async (reason) => {
            if (!actor) return
            await run('reopen', async () => setPr(await S.reopenRequest({ id: pr.id, reason, actor })))
            setAsk(null)
          }}
        />
      )}
      {ask && typeof ask === 'object' && (
        <ReasonModal
          title={t('นำ {name} ออก', { name: ask.remove.productName })}
          confirmText={t('นำออก')}
          danger
          onClose={() => setAsk(null)}
          onConfirm={async (reason) => {
            if (!actor) return
            await run('remove', async () => setPr(await S.removeItem({ id: pr.id, idx: ask.remove.idx, reason, actor })))
            setAsk(null)
          }}
        />
      )}
      {converting && (
        <ConvertModal
          groups={groups.map((g) => ({
            supplierId: g.supplierId,
            supplierName: g.supplierName,
            lines: g.items.length,
            leadTimeDays: suppliers.find((s) => s.id === g.supplierId)?.leadTimeDays,
          }))}
          busy={busy === 'convert'}
          onClose={() => setConverting(false)}
          onConfirm={convert}
        />
      )}
      {sending && (
        <SendWizard
          orders={orders}
          onStatus={async (o) => setOrders((cur) => cur.map((x) => (x.id === o.id ? { ...x, ...o } : x)))}
          onClose={() => setSending(false)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, tone = 'plain' }: { label: string; value: number; tone?: 'plain' | 'in' }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`num text-2xl font-semibold ${tone === 'in' ? 'text-in' : 'text-ink'}`}>{fmtQty(value)}</div>
    </Card>
  )
}

/** The human word for a history action. */
export function historyText(action: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    created: t('สร้างรายการ'),
    itemAdded: t('เพิ่มสินค้า'),
    qtyChanged: t('แก้จำนวนที่ขอ'),
    itemRemoved: t('ลบสินค้า'),
    supplierChanged: t('เปลี่ยนผู้ขาย'),
    itemNoteChanged: t('แก้หมายเหตุรายการ'),
    urgencyChanged: t('เปลี่ยนความเร่งด่วน'),
    warehouseChanged: t('เปลี่ยนคลัง'),
    noteChanged: t('แก้หมายเหตุ'),
    submitted: t('ส่งให้หัวหน้าตรวจ'),
    resubmitted: t('ส่งตรวจอีกครั้ง'),
    returned: t('ส่งกลับให้แก้ไข'),
    managerQtyChanged: t('แก้จำนวนที่อนุมัติ'),
    managerAddedItem: t('หัวหน้าเพิ่มสินค้า'),
    managerRemovedItem: t('หัวหน้านำสินค้าออก'),
    approved: t('อนุมัติ'),
    rejected: t('ไม่อนุมัติ'),
    reopened: t('เปิดตรวจใหม่'),
    exported: t('ส่งออกไฟล์'),
    convertedToPo: t('สร้างใบสั่งซื้อ'),
  }
  return map[action] ?? action
}

/**
 * The last question before the orders exist: when is each supplier to deliver? One date
 * per supplier, started from their lead time, written on the order it becomes — the
 * calendar's receiving entries and the "late" flag hang off it.
 */
function ConvertModal({
  groups,
  busy,
  onClose,
  onConfirm,
}: {
  groups: { supplierId: string; supplierName: string; lines: number; leadTimeDays?: number }[]
  busy: boolean
  onClose: () => void
  onConfirm: (expectedAt: Record<string, number>) => Promise<void> | void
}) {
  const t = useT()
  const [dates, setDates] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((g) => [g.supplierId, msToDateInput(Date.now() + (g.leadTimeDays ?? 0) * 86_400_000)])),
  )
  return (
    <Modal open onClose={onClose} title={t('สร้างใบสั่งซื้อ')}>
      <p className="mb-3 text-sm text-ink-soft">
        {t('สร้างใบสั่งซื้อ {n} ใบจากจำนวนที่อนุมัติ — ทำได้ครั้งเดียว ระบุวันที่ให้ส่งของของแต่ละผู้ขาย', { n: groups.length })}
      </p>
      <div className="space-y-3">
        {groups.map((g) => (
          <Field
            key={g.supplierId}
            label={`${g.supplierName} · ${t('{count} รายการ', { count: g.lines })}`}
            hint={g.leadTimeDays !== undefined ? t('ระยะส่งของผู้ขาย {n} วัน', { n: g.leadTimeDays }) : undefined}
          >
            <Input type="date" value={dates[g.supplierId] ?? ''} onChange={(e) => setDates((cur) => ({ ...cur, [g.supplierId]: e.target.value }))} />
          </Field>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('ยกเลิก')}
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            const out: Record<string, number> = {}
            for (const [id, v] of Object.entries(dates)) if (v) out[id] = dateInputToMs(v)
            void onConfirm(out)
          }}
        >
          {busy ? t('กำลังสร้าง...') : t('สร้างใบสั่งซื้อ')}
        </Button>
      </div>
    </Modal>
  )
}
