import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/Confirm'
import { Icon } from '../../components/Icon'
import { SiteChip } from '../../components/SiteChip'
import {
  Button,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from '../../components/ui'
import {
  FramePage,
  PageHero,
  SectionCard,
  StatusChip,
  WithSidePanel,
} from '../../components/frame'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { fmtQty, formatThaiDateShort, formatThaiDateTime } from '../../lib/format'
import {
  canApprove,
  canReceive,
  isManager,
  TRANSFER_STATUS_KEYS,
  transferBadgeColor,
} from '../../lib/transferStatus'
import {
  cancelTransfer,
  confirmReceive,
  reportMisroute,
  resolveDiscrepancy,
  resolveMisroute,
  reviewTransfer,
  type ReceivedLineInput,
} from '../../services/transfers'
import type {
  DiscrepancyKind,
  DiscrepancyReason,
  DiscrepancyResolutionCode,
  Role,
  Transfer,
  TransferItem,
} from '../../types'

interface TransferDetailViewProps {
  initial: Transfer
  onChange: (t: Transfer) => void
}

export function TransferDetailView({
  initial,
  onChange,
}: TransferDetailViewProps) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { locations } = useData()

  const [transfer, setTransfer] = useState<Transfer>(initial)
  const [busy, setBusy] = useState(false)

  // Modals state
  const [showReceive, setShowReceive] = useState(false)
  const [resolvingItem, setResolvingItem] = useState<TransferItem | null>(null)
  const [resolvingMisroute, setResolvingMisroute] = useState<{
    item: TransferItem
    misrouteId: string
  } | null>(null)
  const [showCancel, setShowCancel] = useState(false)

  const actor = useMemo(
    () => ({
      id: user!.id,
      name: user!.name,
      role: user!.role as Role,
      siteIds: user!.siteIds,
    }),
    [user],
  )

  const locationMap = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations],
  )
  const locName = (id: string) => locationMap.get(id)?.name ?? id

  const manager = isManager(actor.role)
  const userCanApprove = canApprove(transfer, actor)
  const userCanReceive = canReceive(transfer, actor)

  const color = transferBadgeColor(transfer.status)

  async function handleApprove() {
    const ok = await confirm({
      title: t('อนุมัติการขนส่งสินค้า'),
      message: t(
        'การอนุมัตินี้จะตัดสต๊อกออกจากคลังต้นทาง ({from}) ไปยังคลังระหว่างขนส่ง (Transit)',
        { from: locName(transfer.fromLocationId) },
      ),
      confirmText: t('ยืนยันอนุมัติและตัดสต๊อก'),
    })
    if (!ok) return

    setBusy(true)
    try {
      const updated = await reviewTransfer({
        transferId: transfer.id,
        expectedRevision: transfer.revision,
        actor,
        action: 'approve',
      })
      setTransfer(updated)
      onChange(updated)
      toast.success(t('อนุมัติการขนส่งเรียบร้อย ({docNo})', { docNo: updated.docNo }))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel(reason: string) {
    setBusy(true)
    try {
      const updated = await cancelTransfer(transfer.id, actor, reason)
      setTransfer(updated)
      onChange(updated)
      setShowCancel(false)
      toast.success(t('ยกเลิกเอกสารเรียบร้อย'))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FramePage>
      <PageHero
        icon="swap"
        tone="brand"
        title={transfer.docNo}
        subtitle={
          <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm">
            <span>{t('สร้างเมื่อ {date}', { date: formatThaiDateTime(transfer.createdAt) })}</span>
            {transfer.parentId && (
              <span>
                · {t('สืบทอดจาก')}{' '}
                <Link
                  to={`/transfers/${transfer.parentId}`}
                  className="font-medium text-brand underline"
                >
                  {t('เอกสารหลัก')}
                </Link>
              </span>
            )}
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {transfer.status === 'pendingApproval' && (
              <>
                {userCanApprove && (
                  <Button onClick={handleApprove} disabled={busy}>
                    <Icon name="check" size={16} />
                    {t('อนุมัติและตัดสต๊อกขนส่ง')}
                  </Button>
                )}
                {manager && (
                  <Button
                    variant="outline"
                    onClick={() => setShowCancel(true)}
                    disabled={busy}
                  >
                    <Icon name="x" size={16} />
                    {t('ยกเลิกคำขอ')}
                  </Button>
                )}
              </>
            )}

            {(transfer.status === 'inTransit' || transfer.status === 'receiving') && (
              <Button
                onClick={() => setShowReceive(true)}
                disabled={busy || !userCanReceive}
              >
                <Icon name="receive" size={16} />
                {t('ตรวจรับสินค้า')}
              </Button>
            )}

            {transfer.status === 'draft' && (
              <Button onClick={() => navigate(`/transfers/${transfer.id}`)}>
                <Icon name="pencil" size={16} />
                {t('แก้ไข')}
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip tone={color}>
          {t(TRANSFER_STATUS_KEYS[transfer.status])}
        </StatusChip>
        {transfer.legKind && (
          <StatusChip tone="slate">
            {transfer.legKind === 'return'
              ? t('สายส่งกลับ')
              : transfer.legKind === 'forward'
                ? t('สายส่งต่อ')
                : t('สายเก็บไว้')}
          </StatusChip>
        )}
      </div>

      <WithSidePanel
        side={
          <>
            <SectionCard icon="note" title={t('ข้อมูลเส้นทางและเอกสาร')}>
              <div className="space-y-3 text-xs md:text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-ink-soft">{t('ต้นทาง:')} </span>
                  <SiteChip locationId={transfer.fromLocationId} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-ink-soft">{t('ปลายทาง:')} </span>
                  <SiteChip locationId={transfer.toLocationId} />
                </div>
                <div>
                  <span className="text-ink-soft">{t('วันที่ขนส่ง:')} </span>
                  <span className="font-medium">
                    {formatThaiDateShort(transfer.dispatchDate)}
                  </span>
                </div>
                <div>
                  <span className="text-ink-soft">{t('ผู้ขอโอน:')} </span>
                  <span className="font-medium">{transfer.requestedByName}</span>
                </div>
                {transfer.approvedByName && (
                  <div>
                    <span className="text-ink-soft">{t('ผู้อนุมัติ:')} </span>
                    <span className="font-medium">{transfer.approvedByName}</span>
                    <span className="ml-1 text-2xs text-ink-faint">
                      ({formatThaiDateTime(transfer.approvedAt!)})
                    </span>
                  </div>
                )}
                {transfer.receivedByName && (
                  <div>
                    <span className="text-ink-soft">{t('ผู้ตรวจรับ:')} </span>
                    <span className="font-medium">{transfer.receivedByName}</span>
                    <span className="ml-1 text-2xs text-ink-faint">
                      ({formatThaiDateTime(transfer.receivedAt!)})
                    </span>
                  </div>
                )}
                {transfer.dispatchMovementDocNo && (
                  <div>
                    <span className="text-ink-soft">{t('ใบตัดสต๊อกต้นทาง:')} </span>
                    <span className="font-mono font-medium text-brand">
                      {transfer.dispatchMovementDocNo}
                    </span>
                  </div>
                )}
                {transfer.receiveMovementDocNo && (
                  <div>
                    <span className="text-ink-soft">{t('ใบรับเข้าปลายทาง:')} </span>
                    <span className="font-mono font-medium text-emerald-600">
                      {transfer.receiveMovementDocNo}
                    </span>
                  </div>
                )}
                {transfer.note && (
                  <div className="rounded-lg bg-sunken p-2.5 text-xs text-ink-soft">
                    <span className="font-medium text-ink">{t('หมายเหตุ:')} </span>
                    {transfer.note}
                  </div>
                )}
              </div>
            </SectionCard>

            {/* Audit History Timeline */}
            <SectionCard icon="history" title={t('ประวัติการดำเนินงาน')}>
              <div className="space-y-3">
                {transfer.history.map((h, i) => (
                  <div key={i} className="relative border-l-2 border-line pl-3 text-xs">
                    <div className="font-medium text-ink">{h.byName}</div>
                    <div className="text-ink-soft">{h.action}</div>
                    {h.note && <div className="text-2xs text-ink-faint">{h.note}</div>}
                    <div className="text-3xs text-ink-faint">
                      {formatThaiDateTime(h.at)}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </>
        }
      >
        {/* Items Table */}
        <SectionCard
          icon="package"
          title={t('รายการสินค้า')}
          count={t('({n} รายการ)', { n: transfer.items.length })}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs md:text-sm">
              <thead className="border-b border-line bg-sunken/60 text-ink-soft">
                <tr>
                  <th className="py-2.5 pl-3 pr-2">#</th>
                  <th className="py-2.5 px-2">{t('สินค้า')}</th>
                  <th className="py-2.5 px-2 text-right">{t('ขอโอน')}</th>
                  <th className="py-2.5 px-2 text-right">{t('ส่งออก')}</th>
                  <th className="py-2.5 px-2 text-right">{t('รับจริง')}</th>
                  <th className="py-2.5 px-2">{t('หน่วย')}</th>
                  <th className="py-2.5 px-2">{t('สถานะรายการ')}</th>
                  <th className="py-2.5 pr-3 pl-2 text-right">{t('จัดการ')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {transfer.items.map((item, idx) => {
                  const hasDiscrepancy = Boolean(item.discrepancy)
                  const discResolved = Boolean(item.discrepancy?.resolution)
                  const hasMisroute = Boolean(item.misroutes && item.misroutes.length > 0)

                  return (
                    <tr key={idx} className="hover:bg-sunken/30">
                      <td className="py-3 pl-3 pr-2 font-mono text-ink-soft">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-2">
                        <div className="font-medium text-ink">{item.productName}</div>
                        {item.sku && (
                          <div className="text-2xs font-mono text-ink-faint">{item.sku}</div>
                        )}
                      </td>
                      <td className="py-3 px-2 text-right font-medium text-ink">
                        {item.requestedQty != null ? fmtQty(item.requestedQty) : '—'}
                      </td>
                      <td className="py-3 px-2 text-right font-medium text-ink">
                        {item.dispatchQty !== undefined ? fmtQty(item.dispatchQty) : '—'}
                      </td>
                      <td className="py-3 px-2 text-right font-medium text-ink">
                        {item.receivedQty !== undefined ? fmtQty(item.receivedQty) : '—'}
                      </td>
                      <td className="py-3 px-2 text-ink-soft">{item.unit}</td>
                      <td className="py-3 px-2">
                        {hasDiscrepancy ? (
                          <div className="space-y-0.5">
                            <StatusChip tone={discResolved ? 'green' : 'red'} size="sm">
                              {discResolved ? t('แก้ไขผลต่างแล้ว') : t('มีผลต่าง')}
                            </StatusChip>
                            <div className="text-2xs text-ink-soft">
                              {item.discrepancy?.kind} ({fmtQty(item.discrepancy?.qty ?? 0)})
                            </div>
                          </div>
                        ) : hasMisroute ? (
                          <StatusChip tone="amber" size="sm">
                            {t('ส่งผิดสาขา')}
                          </StatusChip>
                        ) : item.receivedQty !== undefined ? (
                          <StatusChip tone="green" size="sm">
                            {t('ครบถ้วน')}
                          </StatusChip>
                        ) : (
                          <StatusChip tone="slate" size="sm">
                            {transfer.status === 'pendingApproval'
                              ? t('รออนุมัติ')
                              : t('ระหว่างขนส่ง')}
                          </StatusChip>
                        )}
                      </td>
                      <td className="py-3 pr-3 pl-2 text-right">
                        {manager && hasDiscrepancy && !discResolved && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setResolvingItem(item)}
                          >
                            {t('ปรับยอด')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* Discrepancies breakdown section */}
        {transfer.items.some((i) => i.discrepancy) && (
          <SectionCard icon="alertCircle" title={t('รายการผลต่าง / ปัญหาการรับสินค้า')}>
            <div className="space-y-3">
              {transfer.items
                .filter((i) => i.discrepancy)
                .map((item, idx) => {
                  const d = item.discrepancy!
                  return (
                    <div
                      key={idx}
                      className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-ink">{item.productName}</span>
                          <StatusChip tone={d.resolution ? 'green' : 'red'} size="sm">
                            {d.kind} ({fmtQty(d.qty)} {item.unit})
                          </StatusChip>
                        </div>
                        <div className="text-xs text-ink-soft">
                          <span>{t('สาเหตุ:')} {d.reason}</span>
                          {d.note && <span className="ml-2">({d.note})</span>}
                        </div>
                        {d.resolution && (
                          <div className="text-xs text-emerald-700">
                            {t('วิธีแก้ไข:')} {d.resolution.code} {t('โดย')}{' '}
                            {d.resolution.byName}
                          </div>
                        )}
                      </div>

                      {manager && !d.resolution && (
                        <Button
                          size="sm"
                          onClick={() => setResolvingItem(item)}
                        >
                          <Icon name="check" size={14} />
                          {t('จัดการผลต่าง')}
                        </Button>
                      )}
                    </div>
                  )
                })}
            </div>
          </SectionCard>
        )}

        {/* Misroute reports section */}
        {transfer.items.some((i) => i.misroutes && i.misroutes.length > 0) && (
          <SectionCard icon="swap" title={t('รายงานสินค้าส่งผิดสาขา')}>
            <div className="space-y-3">
              {transfer.items.map((item) =>
                (item.misroutes ?? []).map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink">{item.productName}</span>
                        <StatusChip tone={m.resolution ? 'green' : 'amber'} size="sm">
                          {t('ของอยู่ที่:')} {locName(m.actualCustodyLocationId)} ({fmtQty(m.qty)} {item.unit})
                        </StatusChip>
                      </div>
                      <div className="text-xs text-ink-soft">
                        {t('รายงานโดย')} {m.reportedByName}
                        {m.note && <span className="ml-1">· {m.note}</span>}
                      </div>
                      {m.resolution && (
                        <div className="text-xs text-emerald-700">
                          {t('การจัดการ:')} {m.resolution.action} ({t('โดย')} {m.resolution.byName})
                        </div>
                      )}
                    </div>

                    {manager && !m.resolution && (
                      <Button
                        size="sm"
                        onClick={() =>
                          setResolvingMisroute({ item, misrouteId: m.id })
                        }
                      >
                        {t('จัดการส่งผิดสาขา')}
                      </Button>
                    )}
                  </div>
                )),
              )}
            </div>
          </SectionCard>
        )}
      </WithSidePanel>

      {/* Modal: Receiving */}
      {showReceive && (
        <ReceivingModal
          transfer={transfer}
          actor={actor}
          locations={locations}
          onClose={() => setShowReceive(false)}
          onSuccess={(updated) => {
            setTransfer(updated)
            onChange(updated)
            setShowReceive(false)
          }}
        />
      )}

      {/* Modal: Discrepancy Resolution */}
      {resolvingItem && (
        <DiscrepancyModal
          transfer={transfer}
          item={resolvingItem}
          actor={actor}
          onClose={() => setResolvingItem(null)}
          onSuccess={(updated) => {
            setTransfer(updated)
            onChange(updated)
            setResolvingItem(null)
          }}
        />
      )}

      {/* Modal: Misroute Resolution */}
      {resolvingMisroute && (
        <MisrouteModal
          transfer={transfer}
          item={resolvingMisroute.item}
          misrouteId={resolvingMisroute.misrouteId}
          actor={actor}
          onClose={() => setResolvingMisroute(null)}
          onSuccess={(updated) => {
            setTransfer(updated)
            onChange(updated)
            setResolvingMisroute(null)
          }}
        />
      )}

      {/* Modal: Cancel */}
      {showCancel && (
        <CancelModal
          onClose={() => setShowCancel(false)}
          onSubmit={handleCancel}
          busy={busy}
        />
      )}
    </FramePage>
  )
}

// ---------------------------------------------------------------- ReceivingModal
function ReceivingModal({
  transfer,
  actor,
  locations,
  onClose,
  onSuccess,
}: {
  transfer: Transfer
  actor: { id: string; name: string; role: Role; siteIds?: string[] }
  locations: { id: string; name: string; active?: boolean }[]
  onClose: () => void
  onSuccess: (updated: Transfer) => void
}) {
  const t = useT()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  // Map of received quantities for each item idx
  const [receivedMap, setReceivedMap] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {}
    for (const item of transfer.items) {
      init[item.idx] = item.dispatchQty ?? item.requestedQty ?? 0
    }
    return init
  })

  // Discrepancy reasons / notes for items where received != dispatched
  const [discrepancies, setDiscrepancies] = useState<
    Record<
      number,
      { kind: DiscrepancyKind; reason: DiscrepancyReason; note: string }
    >
  >({})

  // Optional misroute reporting
  const [misroutes, setMisroutes] = useState<
    Array<{
      itemIdx: number
      actualCustodyLocationId: string
      qty: number
      note: string
    }>
  >([])

  function handleQtyChange(idx: number, qty: number) {
    setReceivedMap((prev) => ({ ...prev, [idx]: qty }))
    const item = transfer.items.find((i) => i.idx === idx)
    const expected = item?.dispatchQty ?? item?.requestedQty ?? 0

    if (qty < expected) {
      setDiscrepancies((prev) => ({
        ...prev,
        [idx]: prev[idx] ?? {
          kind: 'short',
          reason: 'SHORT',
          note: '',
        },
      }))
    } else if (qty > expected) {
      setDiscrepancies((prev) => ({
        ...prev,
        [idx]: prev[idx] ?? {
          kind: 'over',
          reason: 'OVER',
          note: '',
        },
      }))
    } else {
      setDiscrepancies((prev) => {
        const next = { ...prev }
        delete next[idx]
        return next
      })
    }
  }

  async function handleSubmit() {
    setBusy(true)
    try {
      const receivedLines: ReceivedLineInput[] = transfer.items.map((item) => {
        const receivedQty = receivedMap[item.idx] ?? item.dispatchQty
        const expected = item.dispatchQty
        const disc = discrepancies[item.idx]

        let discrepancyData = undefined
        if (disc && receivedQty !== expected) {
          discrepancyData = {
            kind: disc.kind,
            reason: disc.reason,
            qty: Math.abs(expected - receivedQty),
            note: disc.note.trim() || undefined,
          }
        }

        return {
          idx: item.idx,
          receivedQty,
          discrepancy: discrepancyData,
        }
      })

      const updated = await confirmReceive({
        transferId: transfer.id,
        actor,
        receivedLines,
      })

      for (const m of misroutes) {
        await reportMisroute({
          transferId: transfer.id,
          itemIdx: m.itemIdx,
          actualCustodyLocationId: m.actualCustodyLocationId,
          qty: m.qty,
          actor,
          note: m.note.trim() || undefined,
        })
      }

      toast.success(t('ตรวจรับสินค้าเรียบร้อย'))
      onSuccess(updated)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('ตรวจรับสินค้า ({docNo})', { docNo: transfer.docNo })} wide>
      <div className="space-y-4 p-4 text-xs md:text-sm">
        <p className="text-ink-soft">
          {t('ระบุจำนวนที่นับรับเข้าจริง หากสินค้าขาด เกิน หรือเสียหาย กรุณาระบุเหตุผล')}
        </p>

        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left">
            <thead className="border-b border-line bg-sunken/60 text-ink-soft">
              <tr>
                <th className="py-2.5 pl-3 pr-2">#</th>
                <th className="py-2.5 px-2">{t('สินค้า')}</th>
                <th className="py-2.5 px-2 text-right">{t('ส่งมา')}</th>
                <th className="py-2.5 px-2 text-right w-32">{t('รับจริง')}</th>
                <th className="py-2.5 pr-3 pl-2">{t('หน่วย')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {transfer.items.map((item, i) => {
                const expected = item.dispatchQty ?? item.requestedQty ?? 0
                const actual = receivedMap[item.idx] ?? expected
                const hasDiff = actual !== expected
                const disc = discrepancies[item.idx]

                return (
                  <tr key={i} className={hasDiff ? 'bg-amber-500/5' : ''}>
                    <td className="py-3 pl-3 pr-2 font-mono text-ink-soft">{i + 1}</td>
                    <td className="py-3 px-2">
                      <div className="font-medium text-ink">{item.productName}</div>
                      {hasDiff && disc && (
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Select
                            value={disc.reason}
                            onChange={(e) =>
                              setDiscrepancies((prev) => ({
                                ...prev,
                                [item.idx]: {
                                  ...prev[item.idx],
                                  reason: e.target.value as DiscrepancyReason,
                                },
                              }))
                            }
                          >
                            <option value="SHORT">{t('ของขาด (ส่งมาไม่ครบ)')}</option>
                            <option value="OVER">{t('ของเกิน (ส่งมาเกิน)')}</option>
                            <option value="DAMAGED">{t('สินค้าชำรุด/เสียหาย')}</option>
                            <option value="WEIGHT_VARIANCE">{t('น้ำหนักต่างจากป้าย')}</option>
                            <option value="WRONG_ITEM">{t('ส่งสินค้าผิดรายการ')}</option>
                            <option value="WRONG_BRANCH">{t('ส่งผิดสาขา')}</option>
                            <option value="COUNTING_ERROR">{t('นับจำนวนผิดพลาด')}</option>
                            <option value="OTHER">{t('อื่นๆ')}</option>
                          </Select>
                          <Input
                            placeholder={t('ระบุรายละเอียดเหตุผล')}
                            value={disc.note}
                            onChange={(e) =>
                              setDiscrepancies((prev) => ({
                                ...prev,
                                [item.idx]: {
                                  ...prev[item.idx],
                                  note: e.target.value,
                                },
                              }))
                            }
                          />
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-2 text-right font-medium text-ink">
                      {fmtQty(expected)}
                    </td>
                    <td className="py-3 px-2 text-right">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={actual}
                        onChange={(e) =>
                          handleQtyChange(item.idx, parseFloat(e.target.value) || 0)
                        }
                        className="text-right font-mono"
                      />
                    </td>
                    <td className="py-3 pr-3 pl-2 text-ink-soft">{item.unit}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Misroute Button */}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setMisroutes((prev) => [
                ...prev,
                {
                  itemIdx: transfer.items[0]?.idx ?? 0,
                  actualCustodyLocationId: locations[0]?.id ?? '',
                  qty: 1,
                  note: '',
                },
              ])
            }
          >
            <Icon name="plus" size={14} />
            {t('รายงานสินค้าส่งผิดสาขา')}
          </Button>

          {misroutes.length > 0 && (
            <div className="mt-3 space-y-2 rounded-xl border border-line bg-sunken/40 p-3">
              <div className="font-semibold text-ink">{t('รายการส่งผิดสาขา')}</div>
              {misroutes.map((m, mIdx) => (
                <div key={mIdx} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <Select
                    value={m.itemIdx}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10)
                      setMisroutes((prev) =>
                        prev.map((x, idx) => (idx === mIdx ? { ...x, itemIdx: val } : x)),
                      )
                    }}
                  >
                    {transfer.items.map((it) => (
                      <option key={it.idx} value={it.idx}>
                        {it.productName}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={m.actualCustodyLocationId}
                    onChange={(e) => {
                      const val = e.target.value
                      setMisroutes((prev) =>
                        prev.map((x, idx) =>
                          idx === mIdx ? { ...x, actualCustodyLocationId: val } : x,
                        ),
                      )
                    }}
                  >
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    value={m.qty}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0
                      setMisroutes((prev) =>
                        prev.map((x, idx) => (idx === mIdx ? { ...x, qty: val } : x)),
                      )
                    }}
                    placeholder={t('จำนวน')}
                  />
                  <Input
                    value={m.note}
                    onChange={(e) => {
                      const val = e.target.value
                      setMisroutes((prev) =>
                        prev.map((x, idx) => (idx === mIdx ? { ...x, note: val } : x)),
                      )
                    }}
                    placeholder={t('หมายเหตุ')}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('ยกเลิก')}
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            <Icon name="check" size={16} />
            {busy ? t('กำลังบันทึก...') : t('ยืนยันการรับสินค้า')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- DiscrepancyModal
function DiscrepancyModal({
  transfer,
  item,
  actor,
  onClose,
  onSuccess,
}: {
  transfer: Transfer
  item: TransferItem
  actor: { id: string; name: string; role: Role; siteIds?: string[] }
  onClose: () => void
  onSuccess: (updated: Transfer) => void
}) {
  const t = useT()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState<DiscrepancyResolutionCode>('NOT_ACTUALLY_LOADED')
  const [note, setNote] = useState('')

  async function handleResolve() {
    setBusy(true)
    try {
      const updated = await resolveDiscrepancy({
        transferId: transfer.id,
        itemIdx: item.idx,
        resolution: {
          code,
          qty: item.discrepancy?.qty ?? 0,
          note: note.trim() || undefined,
        },
        actor,
      })
      toast.success(t('บันทึกการปรับยอดผลต่างเรียบร้อย'))
      onSuccess(updated)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('จัดการผลต่าง: {product}', { product: item.productName })}>
      <div className="space-y-4 p-4 text-xs md:text-sm">
        <div className="rounded-lg bg-sunken p-3 space-y-1">
          <div className="text-ink-soft">
            {t('ส่งออก:')} {fmtQty(item.dispatchQty ?? item.requestedQty ?? 0)} {item.unit} · {t('รับจริง:')}{' '}
            {fmtQty(item.receivedQty ?? 0)} {item.unit}
          </div>
          <div className="font-semibold text-rose-600">
            {t('ผลต่าง:')} {item.discrepancy?.kind} ({fmtQty(item.discrepancy?.qty ?? 0)} {item.unit})
          </div>
          {item.discrepancy?.note && (
            <div className="text-ink-soft">{t('เหตุผลที่รายงาน:')} {item.discrepancy.note}</div>
          )}
        </div>

        <Field label={t('วิธีจัดการและปรับยอดสต๊อก')} required>
          <Select
            value={code}
            onChange={(e) => setCode(e.target.value as DiscrepancyResolutionCode)}
          >
            <option value="NOT_ACTUALLY_LOADED">
              {t('ไม่ได้ขนขึ้นรถจริง (คืนสต๊อกต้นทาง)')}
            </option>
            <option value="LOST_IN_TRANSIT">
              {t('ของหายระหว่างทาง (ตัดยอดสูญหาย)')}
            </option>
            <option value="DAMAGED_IN_TRANSIT">
              {t('เสียหายระหว่างทาง (ตัดยอดชำรุด)')}
            </option>
            <option value="WEIGHING_ERROR">
              {t('ชั่งน้ำหนักคลาดเคลื่อน (ปรับยอดรับจริง)')}
            </option>
            <option value="OVER_DISPATCHED">
              {t('คลังส่งเกินจริง (หักคลังหลักเข้าสาขา)')}
            </option>
            <option value="COUNTING_ERROR">
              {t('นับผิดเอง (ปรับยอดรับจริง)')}
            </option>
            <option value="APPROVED_ADJUSTMENT">
              {t('อนุมัติรับเข้าสต๊อก (รับเข้าสาขา)')}
            </option>
          </Select>
        </Field>

        <Field label={t('หมายเหตุการจัดการ')}>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('ระบุบันทึกเพิ่มเติม')}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('ยกเลิก')}
          </Button>
          <Button onClick={handleResolve} disabled={busy}>
            <Icon name="check" size={16} />
            {busy ? t('กำลังบันทึก...') : t('ยืนยันการปรับยอด')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- MisrouteModal
function MisrouteModal({
  transfer,
  item,
  misrouteId,
  actor,
  onClose,
  onSuccess,
}: {
  transfer: Transfer
  item: TransferItem
  misrouteId: string
  actor: { id: string; name: string; role: Role; siteIds?: string[] }
  onClose: () => void
  onSuccess: (updated: Transfer) => void
}) {
  const t = useT()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState<'redirect' | 'forward' | 'return'>('forward')
  const [note, setNote] = useState('')

  async function handleResolve() {
    setBusy(true)
    try {
      const res = await resolveMisroute({
        transferId: transfer.id,
        itemIdx: item.idx,
        misrouteId,
        action,
        note: note.trim() || undefined,
        actor,
      })
      toast.success(t('จัดการส่งผิดสาขาเรียบร้อย'))
      onSuccess(res.transfer)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('จัดการส่งผิดสาขา: {product}', { product: item.productName })}>
      <div className="space-y-4 p-4 text-xs md:text-sm">
        <Field label={t('การจัดการการขนส่ง')}>
          <Select
            value={action}
            onChange={(e) => setAction(e.target.value as 'redirect' | 'forward' | 'return')}
          >
            <option value="forward">{t('ส่งต่อไปยังสาขาปลายทางจริง (สร้างสายส่งต่อ)')}</option>
            <option value="return">{t('ส่งกลับไปยังคลังต้นทาง (สร้างสายส่งกลับ)')}</option>
            <option value="redirect">{t('ให้สาขาที่ได้รับสินค้าเก็บไว้ใช้งาน (รับเข้าสต๊อก)')}</option>
          </Select>
        </Field>

        <Field label={t('หมายเหตุ')}>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('ระบุบันทึกเพิ่มเติม')}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('ยกเลิก')}
          </Button>
          <Button onClick={handleResolve} disabled={busy}>
            <Icon name="check" size={16} />
            {busy ? t('กำลังบันทึก...') : t('ยืนยัน')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- CancelModal
function CancelModal({
  onClose,
  onSubmit,
  busy,
}: {
  onClose: () => void
  onSubmit: (reason: string) => void
  busy: boolean
}) {
  const t = useT()
  const [reason, setReason] = useState('')

  return (
    <Modal open onClose={onClose} title={t('ยกเลิกคำขอโอนสินค้า')}>
      <div className="space-y-4 p-4 text-xs md:text-sm">
        <Field label={t('เหตุผลในการยกเลิก')} required>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('ระบุเหตุผลในการยกเลิกเอกสารนี้')}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('ย้อนกลับ')}
          </Button>
          <Button
            variant="danger"
            onClick={() => onSubmit(reason)}
            disabled={busy || !reason.trim()}
          >
            {t('ยืนยันการยกเลิก')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
