import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/Confirm'
import { Icon } from '../../components/Icon'
import { SiteChip } from '../../components/SiteChip'
import { LineBuilder, type Line } from '../../components/LineBuilder'
import { AlertBanner, Badge, Button, Field, Modal, Select, Textarea } from '../../components/ui'
import { FramePage, PageHero, SectionCard, WithSidePanel } from '../../components/frame'
import { useT, type TFn } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { fmtQty, formatThaiDateShort, formatThaiDateTime } from '../../lib/format'
import {
  DISCREPANCY_REASON_KEYS,
  DISCREPANCY_RESOLUTION_KEYS,
  TRANSFER_STATUS_KEYS,
  canApprove,
  canReceive,
  canUserAccessBranch,
  isManager,
  transferBadgeColor,
} from '../../lib/transferStatus'
import {
  cancelTransfer,
  expectedQty,
  getTransfer,
  listOpenTransfers,
  reopenTransfer,
  resolveDiscrepancy,
  resolveMisroute,
  reviewTransfer,
  submitDiscrepancyForApproval,
  transferMovements,
} from '../../services/transfers'
import { ReasonModal } from '../requests/ReasonModal'
import {
  OVER_RESOLUTIONS,
  SHORT_RESOLUTIONS,
  TRANSIT_LOCATION_ID,
  type DiscrepancyResolutionCode,
  type StockMovement,
  type Transfer,
  type TransferHistoryEntry,
  type TransferItem,
} from '../../types'

interface Props {
  initial: Transfer
  onChange: (t: Transfer) => void
}

/**
 * One transfer, for everyone who touches it: the manager reviewing and approving it, the
 * destination receiving it (on its own page — /transfers/:id/receive), the manager settling
 * what did not match, and anyone reading back what happened. The timeline joins the
 * document, its forward/return legs and every ledger row they made, so "where did these
 * cans go" is answered on one screen.
 */
export function TransferDetailView({ initial, onChange }: Props) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { locationById, qtyAt, products, productById } = useData()
  const [transfer, setTransfer] = useState<Transfer>(initial)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState<null | 'return' | 'reject' | 'cancel' | 'reopen'>(null)
  const [resolving, setResolving] = useState<TransferItem | null>(null)
  const [deciding, setDeciding] = useState<{ item: TransferItem; misrouteId: string } | null>(null)
  const [legs, setLegs] = useState<Transfer[]>([])
  const [rows, setRows] = useState<StockMovement[]>([])

  const actor = useMemo(() => ({ id: user!.id, name: user!.name, role: user!.role, siteIds: user!.siteIds }), [user])
  const manager = isManager(actor.role)
  const siteName = (id: string) => (id === TRANSIT_LOCATION_ID ? t('ระหว่างขนส่ง') : locationById(id)?.name ?? id)

  // The legs and the ledger rows are read when the page opens and after each step.
  useEffect(() => {
    let live = true
    ;(async () => {
      const kids = (await Promise.all((transfer.childIds ?? []).map((id) => getTransfer(id)))).filter((x): x is Transfer => !!x)
      const mv = await transferMovements([transfer.id, ...kids.map((k) => k.id)])
      if (live) {
        setLegs(kids)
        setRows(mv)
      }
    })().catch(() => {})
    return () => {
      live = false
    }
  }, [transfer])

  function update(next: Transfer) {
    setTransfer(next)
    onChange(next)
  }

  async function run(fn: () => Promise<Transfer | void>, done?: string) {
    setBusy(true)
    try {
      const next = await fn()
      if (next) update(next)
      if (done) toast.success(done)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  // ---- the manager's review: the dispatch column, edited in place ----
  const reviewing = transfer.status === 'pendingApproval' && canApprove(transfer, actor)
  const [review, setReview] = useState<TransferItem[]>(initial.items)
  const [removing, setRemoving] = useState<{ productId: string; next: Line[] } | null>(null)
  const reviewLines: Line[] = review
    .filter((i) => !i.removed)
    .map((i) => ({
      productId: i.productId,
      productName: i.productName,
      unit: i.unit,
      qty: i.dispatchQty,
      ...(i.dispatchEntryUnit ? { entryUnit: i.dispatchEntryUnit, entryQty: i.dispatchEntryQty } : {}),
    }))
  const reviewChanged = JSON.stringify(review) !== JSON.stringify(transfer.items)

  function onReviewLines(next: Line[]) {
    const gone = reviewLines.find((l) => !next.some((n) => n.productId === l.productId))
    if (gone) {
      setRemoving({ productId: gone.productId, next })
      return
    }
    applyLines(next)
  }

  function applyLines(next: Line[], removed?: { productId: string; reason: string }) {
    setReview((cur) => {
      const byId = new Map(next.map((l) => [l.productId, l]))
      const kept = cur.map((i) => {
        if (removed && i.productId === removed.productId) {
          return { ...i, removed: { by: actor.id, byName: actor.name, at: Date.now(), reason: removed.reason } }
        }
        const l = byId.get(i.productId)
        if (!l || i.removed) return i
        return { ...i, dispatchQty: l.qty, dispatchEntryUnit: l.entryUnit, dispatchEntryQty: l.entryUnit ? l.entryQty : undefined }
      })
      const added = next
        .filter((l) => !cur.some((i) => i.productId === l.productId && !i.removed))
        .map((l, n) => ({
          idx: Math.max(-1, ...cur.map((i) => i.idx)) + 1 + n,
          productId: l.productId,
          productName: l.productName,
          sku: productById(l.productId)?.sku ?? '',
          unit: l.unit,
          requestedQty: null,
          dispatchQty: l.qty,
          ...(l.entryUnit ? { dispatchEntryUnit: l.entryUnit, dispatchEntryQty: l.entryQty } : {}),
        }))
      return [...kept, ...added]
    })
  }

  async function approve() {
    const ok = await confirm({
      title: t('อนุมัติการขนส่งสินค้า'),
      message: t('การอนุมัตินี้จะตัดสต๊อกออกจากคลังต้นทาง ({from}) ไปยังคลังระหว่างขนส่ง (Transit)', { from: siteName(transfer.fromLocationId) }),
      confirmText: t('ยืนยันอนุมัติและตัดสต๊อก'),
    })
    if (!ok) return
    await run(
      () => reviewTransfer({ transferId: transfer.id, expectedRevision: transfer.revision, actor, action: 'approve', items: reviewChanged ? review : undefined }),
      t('อนุมัติการขนส่งเรียบร้อย ({docNo})', { docNo: transfer.docNo }),
    )
  }

  async function withReason(kind: NonNullable<typeof reason>, why: string) {
    setReason(null)
    if (kind === 'cancel') return run(() => cancelTransfer(transfer.id, actor, why), t('ยกเลิกเอกสารเรียบร้อย'))
    if (kind === 'reopen') return run(() => reopenTransfer(transfer.id, actor, why))
    return run(() => reviewTransfer({ transferId: transfer.id, expectedRevision: transfer.revision, actor, action: kind, note: why }))
  }

  const receiver = canReceive(transfer, actor)
  const atDestination = canUserAccessBranch(actor, transfer.toLocationId)
  const open = (i: TransferItem) => !!i.discrepancy && !i.discrepancy.resolution
  const cancellable = ['draft', 'returned', 'pendingApproval'].includes(transfer.status) && (manager || transfer.requestedBy === actor.id)

  return (
    <FramePage>
      <PageHero
        icon="truck"
        tone="brand"
        title={transfer.docNo}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge color={badge(transferBadgeColor(transfer.status))}>{t(TRANSFER_STATUS_KEYS[transfer.status])}</Badge>
            {transfer.legKind && <Badge color="slate">{t(LEG_KEYS[transfer.legKind])}</Badge>}
            {transfer.parentId && (
              <Link to={`/transfers/${transfer.parentId}`} className="text-brand underline">
                {t('เอกสารหลัก')}
              </Link>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate('/transfers')}>
              <Icon name="chevronLeft" size={16} />
              {t('รายการขนส่ง')}
            </Button>
            {receiver && (
              <Button onClick={() => navigate(`/transfers/${transfer.id}/receive`)}>
                <Icon name="receive" size={16} />
                {t('ตรวจรับสินค้า')}
              </Button>
            )}
            {transfer.status === 'discrepancy' && atDestination && (
              <Button disabled={busy} onClick={() => run(() => submitDiscrepancyForApproval(transfer.id, actor), t('ส่งให้หัวหน้าพิจารณาแล้ว'))}>
                <Icon name="arrowRight" size={16} />
                {t('ส่งให้หัวหน้าพิจารณา')}
              </Button>
            )}
            {transfer.status === 'rejected' && actor.role === 'admin' && (
              <Button variant="outline" onClick={() => setReason('reopen')}>
                {t('เปิดคำขอใหม่')}
              </Button>
            )}
            {cancellable && (
              <Button variant="ghost" onClick={() => setReason('cancel')} disabled={busy}>
                {t('ยกเลิกคำขอ')}
              </Button>
            )}
          </div>
        }
      />

      {transfer.status === 'returned' && transfer.returnReason && <AlertBanner tone="warn">{t('หัวหน้าส่งกลับให้แก้ไข')}: {transfer.returnReason}</AlertBanner>}
      {transfer.status === 'rejected' && transfer.rejectReason && <AlertBanner tone="danger">{t('ไม่อนุมัติ')}: {transfer.rejectReason}</AlertBanner>}
      {transfer.status === 'cancelled' && transfer.cancelReason && <AlertBanner tone="danger">{t('ยกเลิกแล้ว')}: {transfer.cancelReason}</AlertBanner>}

      <WithSidePanel
        side={
          <>
            <SectionCard icon="note" title={t('ข้อมูลเส้นทางและเอกสาร')}>
              <dl className="space-y-2 text-sm">
                <Row label={t('ต้นทาง:')}>
                  <SiteChip locationId={transfer.fromLocationId} />
                </Row>
                <Row label={t('ปลายทาง:')}>
                  <SiteChip locationId={transfer.toLocationId} />
                </Row>
                <Row label={t('วันที่ขนส่ง:')}>{formatThaiDateShort(transfer.dispatchDate)}</Row>
                <Row label={t('ผู้ขอโอน:')}>{transfer.requestedByName}</Row>
                {transfer.approvedByName && <Row label={t('ผู้อนุมัติ:')}>{transfer.approvedByName}</Row>}
                {transfer.receivedByName && <Row label={t('ผู้ตรวจรับ:')}>{transfer.receivedByName}</Row>}
                {transfer.note && <Row label={t('หมายเหตุ:')}>{transfer.note}</Row>}
              </dl>
            </SectionCard>

            {legs.length > 0 && (
              <SectionCard icon="swap" title={t('สายส่งต่อ / ส่งกลับ')}>
                <ul className="space-y-2 text-sm">
                  {legs.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-2">
                      <Link to={`/transfers/${l.id}`} className="doc-no font-medium text-brand underline">
                        {l.docNo}
                      </Link>
                      <span className="text-ink-soft">
                        {siteName(l.fromLocationId)} → {siteName(l.toLocationId)}
                      </span>
                      <Badge color={badge(transferBadgeColor(l.status))}>{t(TRANSFER_STATUS_KEYS[l.status])}</Badge>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            )}

            <SectionCard icon="history" title={t('ไทม์ไลน์')}>
              <Timeline transfer={transfer} legs={legs} rows={rows} siteName={siteName} t={t} />
            </SectionCard>
          </>
        }
      >
        {reviewing ? (
          <SectionCard icon="pencil" title={t('ตรวจและแก้ไขจำนวนส่ง')}>
            <p className="mb-3 text-sm text-ink-soft">{t('แก้จำนวนหรือหน่วยที่จะส่ง เพิ่มหรือเอารายการออกได้ — จำนวนที่พนักงานขอยังเก็บไว้ในเอกสาร')}</p>
            <LineBuilder
              products={products}
              lines={reviewLines}
              onChange={onReviewLines}
              availableAt={(pid) => qtyAt(transfer.fromLocationId, pid)}
              direction="out"
            />
            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
              <Button variant="outline" disabled={busy} onClick={() => setReason('return')}>
                {t('ส่งกลับให้แก้ไข')}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => setReason('reject')}>
                {t('ไม่อนุมัติ')}
              </Button>
              <Button disabled={busy || reviewLines.length === 0} onClick={() => void approve()}>
                <Icon name="check" size={16} />
                {t('อนุมัติและตัดสต๊อกขนส่ง')}
              </Button>
            </div>
          </SectionCard>
        ) : null}

        <SectionCard icon="package" title={t('รายการสินค้า')} count={t('({n} รายการ)', { n: transfer.items.filter((i) => !i.removed).length })}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-ink-soft">
                <tr>
                  <th className="py-2 pr-2">{t('สินค้า')}</th>
                  <th className="px-2 py-2 text-right">{t('ขอโอน')}</th>
                  <th className="px-2 py-2 text-right">{t('ส่งออก')}</th>
                  <th className="px-2 py-2 text-right">{t('รับจริง')}</th>
                  <th className="px-2 py-2 text-right">{t('ผลต่าง')}</th>
                  <th className="px-2 py-2 text-right">{t('ค้างระหว่างทาง')}</th>
                  <th className="py-2 pl-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {transfer.items.map((i) => {
                  const variance = i.receivedQty !== undefined ? i.receivedQty - expectedQty(i) : null
                  return (
                    <tr key={i.idx} className={i.removed ? 'text-ink-faint line-through' : ''}>
                      <td className="py-2 pr-2">
                        <div className="font-medium">{i.productName}</div>
                        <div className="text-xs text-ink-faint">
                          {i.sku} · {i.unit}
                          {i.requestedQty === null && ` · ${t('หัวหน้าเพิ่ม')}`}
                          {i.removed && ` · ${t('เอาออก')}: ${i.removed.reason}`}
                        </div>
                      </td>
                      <td className="num px-2 py-2 text-right">{i.requestedQty === null ? '—' : qty(i.requestedQty, i.requestedEntryQty, i.requestedEntryUnit)}</td>
                      <td className="num px-2 py-2 text-right">
                        {qty(i.dispatchQty, i.dispatchEntryQty, i.dispatchEntryUnit)}
                        {i.correctedDispatchQty !== undefined && <div className="text-xs text-warn">{t('แก้เป็น')} {fmtQty(i.correctedDispatchQty)}</div>}
                      </td>
                      <td className="num px-2 py-2 text-right">
                        {i.receivedQty === undefined ? '—' : fmtQty(i.receivedQty)}
                        {i.correctedReceivedQty !== undefined && <div className="text-xs text-warn">{t('แก้เป็น')} {fmtQty(i.correctedReceivedQty)}</div>}
                      </td>
                      <td className={`num px-2 py-2 text-right ${variance ? (variance < 0 ? 'text-out' : 'text-warn') : ''}`}>
                        {variance === null ? '—' : variance > 0 ? `+${fmtQty(variance)}` : fmtQty(variance)}
                      </td>
                      <td className="num px-2 py-2 text-right">{i.inTransitQty ? fmtQty(i.inTransitQty) : '—'}</td>
                      <td className="py-2 pl-2 text-right">
                        {manager && open(i) && ['discrepancy', 'pendingDiscrepancyApproval'].includes(transfer.status) && (
                          <Button size="sm" onClick={() => setResolving(i)}>
                            {t('จัดการผลต่าง')}
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

        {transfer.items.some((i) => i.discrepancy) && (
          <SectionCard icon="alertCircle" title={t('รายการผลต่าง / ปัญหาการรับสินค้า')}>
            <ul className="space-y-3">
              {transfer.items
                .filter((i) => i.discrepancy)
                .map((i) => {
                  const d = i.discrepancy!
                  return (
                    <li key={i.idx} className="rounded-xl border border-line p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{i.productName}</span>
                        <Badge color={d.resolution ? 'green' : 'red'}>
                          {d.kind === 'short' ? t('ขาด') : t('เกิน')} {fmtQty(d.qty)} {i.unit}
                        </Badge>
                        <span className="text-ink-soft">{t(DISCREPANCY_REASON_KEYS[d.reason])}</span>
                      </div>
                      {d.note && <div className="mt-1 text-ink-soft">{d.note}</div>}
                      <div className="mt-1 text-xs text-ink-faint">
                        {t('รายงานโดย')} {d.reportedByName} · {formatThaiDateTime(d.reportedAt)}
                      </div>
                      {d.resolution && (
                        <div className="mt-2 rounded-lg bg-sunken p-2 text-xs">
                          {t(DISCREPANCY_RESOLUTION_KEYS[d.resolution.code])} · {d.resolution.byName} · {formatThaiDateTime(d.resolution.at)}
                          {d.resolution.movementDocNo && <span className="doc-no"> · {d.resolution.movementDocNo}</span>}
                          {d.resolution.note && <div className="text-ink-soft">{d.resolution.note}</div>}
                        </div>
                      )}
                    </li>
                  )
                })}
            </ul>
          </SectionCard>
        )}

        {transfer.items.some((i) => (i.misroutes ?? []).length > 0) && (
          <SectionCard icon="swap" title={t('รายงานสินค้าส่งผิดสาขา')}>
            <ul className="space-y-3">
              {transfer.items.flatMap((i) =>
                (i.misroutes ?? []).map((m) => (
                  <li key={m.id} className="rounded-xl border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{i.productName}</span>
                      <Badge color={m.resolution ? 'green' : 'amber'}>
                        {fmtQty(m.qty)} {i.unit} {t('อยู่ที่')} {siteName(m.actualCustodyLocationId)}
                      </Badge>
                      <span className="text-ink-soft">
                        ({t('ควรไป')} {siteName(m.originalDestinationId)})
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-ink-faint">
                      {t('รายงานโดย')} {m.reportedByName} · {formatThaiDateTime(m.reportedAt)}
                      {m.note && ` · ${m.note}`}
                    </div>
                    {m.resolution ? (
                      <div className="mt-2 rounded-lg bg-sunken p-2 text-xs">
                        {t(MISROUTE_KEYS[m.resolution.action])} · {m.resolution.byName} · {formatThaiDateTime(m.resolution.at)}
                        {m.resolution.movementDocNo && <span className="doc-no"> · {m.resolution.movementDocNo}</span>}
                      </div>
                    ) : (
                      manager && (
                        <div className="mt-2">
                          <Button size="sm" onClick={() => setDeciding({ item: i, misrouteId: m.id })}>
                            {t('จัดการส่งผิดสาขา')}
                          </Button>
                        </div>
                      )
                    )}
                  </li>
                )),
              )}
            </ul>
          </SectionCard>
        )}
      </WithSidePanel>

      {reason && (
        <ReasonModal
          title={t(REASON_TITLES[reason])}
          confirmText={t(REASON_TITLES[reason])}
          danger={reason === 'reject' || reason === 'cancel'}
          onClose={() => setReason(null)}
          onConfirm={(why) => withReason(reason, why)}
        />
      )}
      {removing && (
        <ReasonModal
          title={t('เอารายการออก')}
          message={t('ระบุเหตุผลที่เอารายการนี้ออก — รายการยังเก็บไว้ในเอกสาร')}
          confirmText={t('เอาออก')}
          onClose={() => setRemoving(null)}
          onConfirm={(why) => {
            applyLines(removing.next, { productId: removing.productId, reason: why })
            setRemoving(null)
          }}
        />
      )}
      {resolving && (
        <ResolveDiscrepancy
          transfer={transfer}
          item={resolving}
          onClose={() => setResolving(null)}
          onDone={(next) => {
            update(next)
            setResolving(null)
          }}
        />
      )}
      {deciding && (
        <DecideMisroute
          transfer={transfer}
          item={deciding.item}
          misrouteId={deciding.misrouteId}
          siteName={siteName}
          onClose={() => setDeciding(null)}
          onDone={(next) => {
            update(next)
            setDeciding(null)
          }}
        />
      )}
    </FramePage>
  )
}

const LEG_KEYS = {
  forward: 'สายส่งต่อ', // i18n-key
  return: 'สายส่งกลับ', // i18n-key
  replacement: 'ส่งทดแทน', // i18n-key
} as const

const MISROUTE_KEYS = {
  redirect: 'ให้สาขาที่ได้รับเก็บไว้ (รับเข้าสต๊อก)', // i18n-key
  forward: 'ส่งต่อไปปลายทางเดิม', // i18n-key
  return: 'ส่งกลับต้นทาง', // i18n-key
} as const

const REASON_TITLES = {
  return: 'ส่งกลับให้แก้ไข', // i18n-key
  reject: 'ไม่อนุมัติ', // i18n-key
  cancel: 'ยกเลิกคำขอ', // i18n-key
  reopen: 'เปิดคำขอใหม่', // i18n-key
} as const

const HISTORY_KEYS: Record<string, string> = {
  created: 'สร้างคำขอ', // i18n-key
  itemAdded: 'เพิ่มรายการ', // i18n-key
  itemRemoved: 'เอารายการออก', // i18n-key
  qtyChanged: 'แก้จำนวน', // i18n-key
  unitChanged: 'เปลี่ยนหน่วย', // i18n-key
  submitted: 'ส่งขออนุมัติ', // i18n-key
  approved: 'อนุมัติ', // i18n-key
  movedToTransit: 'ตัดสต๊อกเข้าระหว่างขนส่ง', // i18n-key
  return: 'ส่งกลับให้แก้ไข', // i18n-key
  reject: 'ไม่อนุมัติ', // i18n-key
  reopened: 'เปิดคำขอใหม่', // i18n-key
  receivingOpened: 'สาขาเปิดตรวจรับ', // i18n-key
  received: 'ยืนยันรับสินค้า', // i18n-key
  discrepancyCreated: 'พบผลต่าง', // i18n-key
  discrepancyExplained: 'ระบุเหตุผลผลต่าง', // i18n-key
  discrepancySubmitted: 'ส่งให้หัวหน้าพิจารณา', // i18n-key
  discrepancyResolved: 'หัวหน้าจัดการผลต่าง', // i18n-key
  misrouteReported: 'รายงานพบสินค้าส่งผิดสาขา', // i18n-key
  redirected: 'เปลี่ยนปลายทางเป็นสาขาที่ได้รับ', // i18n-key
  forwarded: 'ส่งต่อไปปลายทางเดิม', // i18n-key
  returnedToSource: 'ส่งกลับต้นทาง', // i18n-key
  legCreated: 'สร้างสายส่ง', // i18n-key
  legClosed: 'สายส่งรับครบ', // i18n-key
  cancelled: 'ยกเลิก', // i18n-key
}

function badge(c: string): 'slate' | 'red' | 'green' | 'amber' | 'blue' {
  return c === 'purple' ? 'blue' : (c as 'slate' | 'red' | 'green' | 'amber' | 'blue')
}

function qty(base: number | null | undefined, entryQty?: number, entryUnit?: string) {
  if (base === null || base === undefined) return '—'
  return entryUnit && entryQty !== undefined ? `${fmtQty(entryQty)} ${entryUnit} (${fmtQty(base)})` : fmtQty(base)
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}

/** The document's history, its legs' history and the ledger rows, in time order. */
function Timeline({
  transfer,
  legs,
  rows,
  siteName,
  t,
}: {
  transfer: Transfer
  legs: Transfer[]
  rows: StockMovement[]
  siteName: (id: string) => string
  t: TFn
}) {
  type Event = { at: number; key: string; title: string; who?: string; detail?: string; doc?: string }
  const fromHistory = (d: Transfer) => (h: TransferHistoryEntry, n: number): Event => ({
    at: h.at,
    key: `${d.id}-${n}`,
    title: HISTORY_KEYS[h.action] ? t(HISTORY_KEYS[h.action]) : h.action,
    who: h.byName,
    detail: [h.note, h.oldQty !== undefined || h.newQty !== undefined ? `${h.oldQty ?? '—'} → ${h.newQty ?? '—'}` : '', h.reason].filter(Boolean).join(' · '),
    doc: d.id === transfer.id ? undefined : d.docNo,
  })
  const events: Event[] = [
    ...transfer.history.map(fromHistory(transfer)),
    ...legs.flatMap((l) => l.history.map(fromHistory(l))),
    ...rows.map((m) => ({
      at: m.createdAt,
      key: m.id,
      title: `${m.docNo} · ${m.productName} ${fmtQty(m.qty)} ${m.unit}`,
      detail: m.type === 'adjust' ? `${siteName(m.fromLocationId ?? m.toLocationId ?? '')} (${m.reason})` : `${siteName(m.fromLocationId ?? '')} → ${siteName(m.toLocationId ?? '')}`,
      who: m.byUserName,
    })),
  ].sort((a, b) => a.at - b.at)
  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li key={e.key} className="border-l-2 border-line pl-3 text-xs">
          <div className="font-medium text-ink">
            {e.title}
            {e.doc && <span className="doc-no ml-1 text-ink-faint">({e.doc})</span>}
          </div>
          {e.detail && <div className="text-ink-soft">{e.detail}</div>}
          <div className="text-ink-faint">
            {e.who} · {formatThaiDateTime(e.at)}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** The manager's decision on one line's difference — only the resolutions that fit it. */
function ResolveDiscrepancy({ transfer, item, onClose, onDone }: { transfer: Transfer; item: TransferItem; onClose: () => void; onDone: (t: Transfer) => void }) {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const { locations } = useData()
  const d = item.discrepancy!
  const codes = d.kind === 'short' ? SHORT_RESOLUTIONS : OVER_RESOLUTIONS
  const [code, setCode] = useState<DiscrepancyResolutionCode>(codes[0])
  const [note, setNote] = useState('')
  const [custody, setCustody] = useState('')
  const [related, setRelated] = useState('')
  const [others, setOthers] = useState<Transfer[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (code !== 'BELONGS_TO_OTHER_TRANSFER') return
    listOpenTransfers()
      .then((rows) => setOthers(rows.filter((r) => r.id !== transfer.id && r.status !== 'pendingApproval' && r.items.some((i) => i.productId === item.productId && (i.inTransitQty ?? 0) > 0))))
      .catch(() => {})
  }, [code, transfer.id, item.productId])

  async function save() {
    if (!user) return
    setBusy(true)
    try {
      const next = await resolveDiscrepancy({
        transferId: transfer.id,
        itemIdx: item.idx,
        resolution: { code, qty: d.qty, note: note.trim() || undefined },
        custodyLocationId: code === 'WRONG_BRANCH' ? custody : undefined,
        relatedTransferId: code === 'BELONGS_TO_OTHER_TRANSFER' ? related : undefined,
        actor: { id: user.id, name: user.name, role: user.role, siteIds: user.siteIds },
      })
      toast.success(t('บันทึกการปรับยอดผลต่างเรียบร้อย'))
      onDone(next)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const ready = (code !== 'WRONG_BRANCH' || !!custody) && (code !== 'BELONGS_TO_OTHER_TRANSFER' || !!related)
  return (
    <Modal open onClose={onClose} title={t('จัดการผลต่าง: {product}', { product: item.productName })}>
      <div className="space-y-4">
        <div className="rounded-lg bg-sunken p-3 text-sm">
          {d.kind === 'short' ? t('ขาด') : t('เกิน')} <b>{fmtQty(d.qty)} {item.unit}</b> · {t(DISCREPANCY_REASON_KEYS[d.reason])}
          {d.note && <div className="text-ink-soft">{d.note}</div>}
        </div>
        <Field label={t('วิธีจัดการและปรับยอดสต๊อก')} required>
          <Select value={code} onChange={(e) => setCode(e.target.value as DiscrepancyResolutionCode)}>
            {codes.map((c) => (
              <option key={c} value={c}>
                {t(DISCREPANCY_RESOLUTION_KEYS[c])}
              </option>
            ))}
          </Select>
        </Field>
        {code === 'WRONG_BRANCH' && (
          <Field label={t('สาขาที่ได้รับสินค้าไปจริง')} required>
            <Select value={custody} onChange={(e) => setCustody(e.target.value)}>
              <option value="">{t('— เลือก —')}</option>
              {locations
                .filter((l) => l.id !== transfer.toLocationId && l.active !== false)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {code === 'BELONGS_TO_OTHER_TRANSFER' && (
          <Field label={t('เป็นของเอกสารใบไหน')} required hint={t('เฉพาะใบที่ยังมีสินค้านี้ค้างระหว่างขนส่ง')}>
            <Select value={related} onChange={(e) => setRelated(e.target.value)}>
              <option value="">{t('— เลือก —')}</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.docNo}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('หมายเหตุการจัดการ')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ระบุบันทึกเพิ่มเติม')} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('ยกเลิก')}
          </Button>
          <Button onClick={save} disabled={busy || !ready}>
            <Icon name="check" size={16} />
            {busy ? t('กำลังบันทึก...') : t('ยืนยันการปรับยอด')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Redirect, forward or return goods found at the wrong branch. */
function DecideMisroute({
  transfer,
  item,
  misrouteId,
  siteName,
  onClose,
  onDone,
}: {
  transfer: Transfer
  item: TransferItem
  misrouteId: string
  siteName: (id: string) => string
  onClose: () => void
  onDone: (t: Transfer) => void
}) {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const m = item.misroutes!.find((x) => x.id === misrouteId)!
  const [action, setAction] = useState<'redirect' | 'forward' | 'return'>('forward')
  const [replacement, setReplacement] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!user) return
    setBusy(true)
    try {
      const res = await resolveMisroute({
        transferId: transfer.id,
        itemIdx: item.idx,
        misrouteId,
        action,
        note: note.trim() || undefined,
        createReplacement: action === 'redirect' && replacement,
        actor: { id: user.id, name: user.name, role: user.role, siteIds: user.siteIds },
      })
      toast.success(t('จัดการส่งผิดสาขาเรียบร้อย'))
      onDone(res.transfer)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const options: { key: typeof action; label: string; hint: string }[] = [
    { key: 'forward', label: t(MISROUTE_KEYS.forward), hint: t('สร้างสายส่ง {from} → {to} ไม่ตัดสต๊อกต้นทางซ้ำ', { from: siteName(m.actualCustodyLocationId), to: siteName(m.originalDestinationId) }) },
    { key: 'return', label: t(MISROUTE_KEYS.return), hint: t('สร้างสายส่ง {from} → {to} ไม่ตัดสต๊อกต้นทางซ้ำ', { from: siteName(m.actualCustodyLocationId), to: siteName(transfer.fromLocationId) }) },
    { key: 'redirect', label: t(MISROUTE_KEYS.redirect), hint: t('รับ {qty} {unit} เข้าสต๊อก {site} ทันที', { qty: fmtQty(m.qty), unit: item.unit, site: siteName(m.actualCustodyLocationId) }) },
  ]
  return (
    <Modal open onClose={onClose} title={t('จัดการส่งผิดสาขา: {product}', { product: item.productName })}>
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">
          {fmtQty(m.qty)} {item.unit} {t('อยู่ที่')} {siteName(m.actualCustodyLocationId)} ({t('ควรไป')} {siteName(m.originalDestinationId)})
        </p>
        {options.map((o) => (
          <label key={o.key} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${action === o.key ? 'border-brand bg-brand-soft' : 'border-line'}`}>
            <input type="radio" name="misroute" className="mt-1" checked={action === o.key} onChange={() => setAction(o.key)} />
            <span>
              <span className="block font-medium">{o.label}</span>
              <span className="block text-xs text-ink-soft">{o.hint}</span>
            </span>
          </label>
        ))}
        {action === 'redirect' && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={replacement} onChange={(e) => setReplacement(e.target.checked)} />
            {t('สร้างร่างคำขอส่งทดแทนให้ {site}', { site: siteName(m.originalDestinationId) })}
          </label>
        )}
        <Field label={t('หมายเหตุ')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ระบุบันทึกเพิ่มเติม')} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('ยกเลิก')}
          </Button>
          <Button onClick={save} disabled={busy}>
            <Icon name="check" size={16} />
            {busy ? t('กำลังบันทึก...') : t('ยืนยัน')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
