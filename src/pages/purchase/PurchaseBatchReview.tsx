import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { RESUME_PARAM } from '../../share/liffResume'
import { useAuth } from '../../auth/AuthContext'
import { useBrand } from '../../brand/BrandContext'
import { brandDef } from '../../brand/brand'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/Confirm'
import { Icon } from '../../components/Icon'
import { PoSheet } from '../../components/PoSheet'
import { Badge, Button, Card, EmptyState, Modal, PageHeader, SectionHeader, Spinner } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { fmtQty, formatThaiDateTime } from '../../lib/format'
import { saveAlias } from '../../services/productAliases'
import { updateProduct } from '../../services/products'
import {
  appendHistory,
  approveBatch,
  cancelBatch,
  ensureDraftOrders,
  getBatch,
  groupState,
  rowState,
  saveRows,
  settleSendStatus,
} from '../../services/purchaseBatch'
import { getPurchaseOrder } from '../../services/purchaseOrders'
import { backend } from '../../backend'
import { getBrand } from '../../brand/brand'
import { COL, type BatchGroup, type BatchRow, type PurchaseBatch, type PurchaseOrder } from '../../types'
import { badgeColor, batchStatusText, groupStateText, historyText, issueText, openIssues, rowStateText } from './issues'
import { ResolveRowModal, type ResolveResult } from './ResolveRowModal'
import { SendWizard } from './SendWizard'
import { useAssessContext } from './useAssessContext'

/**
 * One imported order list: what it became, what still needs a person, and the buttons that
 * move it on.
 *
 * Reads top to bottom the way the work goes: the numbers, the supplier cards (each with
 * its draft or placed order), the rows that still need a decision, then the history. The
 * two big buttons — approve everything that is ready, send everything that is approved —
 * only ever act on what is ready; a row in question holds only its own supplier back.
 */
export function PurchaseBatchReviewPage() {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const { user } = useAuth()
  const { brand } = useBrand()
  const { products, locationById } = useData()
  const { ctx, aliases, suppliers, loading: ctxLoading, reload: reloadCtx } = useAssessContext()

  const [batch, setBatch] = useState<PurchaseBatch | null>(null)
  const [orders, setOrders] = useState<Map<string, PurchaseOrder>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [resolving, setResolving] = useState<BatchRow | null>(null)
  const [viewing, setViewing] = useState<PurchaseOrder | null>(null)
  const [sending, setSending] = useState(false)
  // Back from LINE Login: ?send=<orderId> reopens the wizard (share/liffResume.ts).
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const send = params.get(RESUME_PARAM)
    if (!send || orders.size === 0) return
    if (orders.has(send)) setSending(true)
    setParams({}, { replace: true })
  }, [params, setParams, orders])

  const actor = useMemo(() => (user ? { id: user.id, name: user.name } : null), [user])
  const isAdmin = user?.role === 'admin'
  const company = brand ? brandDef(brand).name : ''

  /** A group's readiness from its rows alone — `groupState` says "ordered" once a draft exists. */
  const rowsReady = useCallback(
    (g: BatchGroup, rows: readonly BatchRow[]) => groupState({ ...g, poId: undefined }, rows),
    [],
  )

  const loadOrders = useCallback(async (b: PurchaseBatch) => {
    const mine = await backend.forBrand(getBrand()).getBy<PurchaseOrder>(COL.purchaseOrders, 'batchId', b.id)
    setOrders(new Map(mine.map((o) => [o.id, o])))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const b = await getBatch(id)
      setBatch(b)
      if (b) await loadOrders(b)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setLoading(false)
    }
  }, [id, loadOrders, toast, t])

  useEffect(() => {
    void load()
  }, [load])

  // Drafts follow the rows: whenever the batch is open and editable, make sure every ready
  // group has its draft so the person can look at the sheet before approving.
  useEffect(() => {
    if (!batch || !actor || ctxLoading) return
    if (!['draft', 'needsReview', 'ready'].includes(batch.status)) return
    const missing = batch.groups.some((g) => !g.poId && rowsReady(g, batch.rows) === 'ready')
    if (!missing) return
    void ensureDraftOrders({ batchId: batch.id, products, actor })
      .then(async (b) => {
        setBatch(b)
        await loadOrders(b)
      })
      .catch((e) => toast.error(errText(e, t)))
  }, [batch, actor, ctxLoading, products, loadOrders, rowsReady, toast, t])

  const stats = useMemo(() => {
    if (!batch) return null
    const rows = batch.rows.filter((r) => !r.skipped)
    return {
      suppliers: batch.groups.length,
      products: rows.length,
      review: rows.filter((r) => ['review', 'blocked'].includes(rowState(r))).length,
      orphan: rows.filter((r) => !r.supplierId).length,
    }
  }, [batch])

  const orphanRows = useMemo(
    () => (batch ? batch.rows.filter((r) => !r.skipped && (!r.supplierId || rowState(r) !== 'ready')) : []),
    [batch],
  )
  const skippedRows = useMemo(() => (batch ? batch.rows.filter((r) => r.skipped) : []), [batch])
  const editable = !!batch && ['draft', 'needsReview', 'ready'].includes(batch.status)
  const placedOrders = useMemo(
    () =>
      batch
        ? batch.groups
            .map((g) => (g.poId ? orders.get(g.poId) : undefined))
            .filter((o): o is PurchaseOrder => !!o && o.status !== 'draft' && o.status !== 'cancelled')
        : [],
    [batch, orders],
  )
  const readyGroups = useMemo(
    () => (batch ? batch.groups.filter((g) => rowsReady(g, batch.rows) === 'ready') : []),
    [batch, rowsReady],
  )
  const unsent = placedOrders.filter((o) => o.shareStatus !== 'sent' && o.shareStatus !== 'skipped')

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

  async function resolved(r: ResolveResult) {
    if (!batch || !ctx || !actor) return
    await run('resolve', async () => {
      if (r.saveAlias && r.row.productId) {
        await saveAlias({ sourceName: r.row.rawName, productId: r.row.productId, actor })
      }
      if (r.setPrimary && r.row.productId && r.row.supplierId) {
        await updateProduct(r.row.productId, { supplierId: r.row.supplierId })
      }
      const rows = batch.rows.map((x) => (x.idx === r.row.idx ? r.row : x))
      const next = await saveRows({ batchId: batch.id, rows, ctx, actor, action: r.action, detail: r.detail })
      const withDrafts = await ensureDraftOrders({ batchId: next.id, products, actor })
      // If every group was already approved, settling the last row settles the batch.
      const settled = await settleSendStatus(withDrafts.id, actor)
      setBatch(settled)
      await loadOrders(settled)
      if (r.saveAlias) await reloadCtx()
      setResolving(null)
    })
  }

  async function restore(row: BatchRow) {
    if (!batch || !ctx || !actor) return
    await run('restore', async () => {
      const rows = batch.rows.map((x) => (x.idx === row.idx ? { ...x, skipped: false } : x))
      const next = await saveRows({ batchId: batch.id, rows, ctx, actor, action: 'rowRestored', detail: row.rawName })
      setBatch(next)
    })
  }

  async function approve(supplierId?: string) {
    if (!batch || !actor) return
    const n = supplierId ? 1 : readyGroups.filter((g) => !placedOrders.some((o) => o.id === g.poId)).length
    const ok = await confirm({
      title: supplierId ? t('อนุมัติใบสั่งซื้อนี้') : t('อนุมัติทั้งหมดที่พร้อม'),
      message: supplierId
        ? t('เปลี่ยนร่างเป็นใบสั่งซื้อจริง จากนั้นจึงส่งให้ผู้ขายได้')
        : t('เปลี่ยนร่าง {n} ใบเป็นใบสั่งซื้อจริง รายการที่ยังต้องตรวจจะไม่ถูกอนุมัติ', { n }),
      confirmText: t('อนุมัติ'),
    })
    if (!ok) return
    await run('approve', async () => {
      const next = await approveBatch({ batchId: batch.id, products, actor, ...(supplierId ? { supplierId } : {}) })
      setBatch(next)
      await loadOrders(next)
      toast.success(t('อนุมัติแล้ว'))
    })
  }

  async function cancel() {
    if (!batch || !actor) return
    const ok = await confirm({
      title: t('ยกเลิกชุดนำเข้า'),
      message: t('ยกเลิก {no}? ร่างใบสั่งซื้อของชุดนี้จะถูกลบ ใบที่อนุมัติแล้วยังอยู่', { no: batch.batchNo }),
      danger: true,
      confirmText: t('ยกเลิกชุด'),
    })
    if (!ok) return
    await run('cancel', async () => {
      // Drafts go with the batch; placed orders are promises and stay.
      for (const g of batch.groups) {
        const o = g.poId ? orders.get(g.poId) : undefined
        if (o?.status === 'draft') {
          const { deletePurchaseOrder } = await import('../../services/purchaseOrders')
          await deletePurchaseOrder(o.id)
        }
      }
      await cancelBatch(batch.id, actor)
      await load()
    })
  }

  async function viewOrder(poId: string) {
    const o = orders.get(poId) ?? (await getPurchaseOrder(poId))
    if (o) setViewing(o)
  }

  async function onSendStatus(order: PurchaseOrder) {
    if (!batch || !actor) return
    setOrders((cur) => new Map(cur).set(order.id, order))
    const next = await appendHistory(batch.id, actor, order.shareStatus ?? 'shareOpened', `${order.supplierName} ${order.docNo}`)
    const settled = await settleSendStatus(next.id, actor)
    setBatch(settled)
  }

  if (loading || ctxLoading) return <Spinner label={t('กำลังโหลด...')} />
  if (!batch || !stats) {
    return <EmptyState icon="upload" title={t('ไม่พบชุดนำเข้านี้')} hint={t('อาจถูกลบไปแล้ว')} />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon="truck"
        title={t('รายการสั่งซื้อ {no}', { no: batch.batchNo })}
        subtitle={`${batch.blockLabel} · ${batch.sourceFileName} · ${locationById(batch.locationId)?.name ?? ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge color={badgeColor(batch.status)}>{batchStatusText(batch.status, t)}</Badge>
            <Button variant="secondary" onClick={() => navigate('/purchase')}>
              {t('ชุดทั้งหมด')}
            </Button>
          </div>
        }
      />

      {/* ---- the numbers ---- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('ผู้ขาย')} value={stats.suppliers} />
        <Stat label={t('รายการ')} value={stats.products} />
        <Stat label={t('ต้องตรวจ')} value={stats.review} tone={stats.review > 0 ? 'warn' : 'plain'} />
        <Stat label={t('ส่งแล้ว')} value={placedOrders.filter((o) => o.shareStatus === 'sent').length} tone="in" />
      </div>

      {/* ---- the suppliers ---- */}
      <div className="space-y-2">
        {batch.groups.map((g) => {
          const state = rowsReady(g, batch.rows)
          const order = g.poId ? orders.get(g.poId) : undefined
          const placed = !!order && order.status !== 'draft' && order.status !== 'cancelled'
          return (
            <Card key={g.supplierId} className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-ink">{g.supplierName}</span>
                    {order && <span className="doc-no text-xs text-ink-faint">{order.docNo}</span>}
                    <Badge color={placed ? 'green' : badgeColor(state)}>
                      {placed ? t('อนุมัติแล้ว') : order ? t('ร่าง') : groupStateText(state, t)}
                    </Badge>
                    {order?.shareStatus === 'sent' && <Badge color="green">{t('ส่งเข้า LINE แล้ว')}</Badge>}
                    {order?.shareStatus === 'skipped' && <Badge>{t('ข้ามการส่ง')}</Badge>}
                    {order?.shareStatus === 'failed' && <Badge color="red">{t('ส่งไม่สำเร็จ')}</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-ink-soft">{t('{count} รายการ', { count: g.rowIdx.length })}</div>
                  <ul className="mt-2 space-y-0.5 text-sm">
                    {g.rowIdx.map((i) => {
                      const r = batch.rows[i]
                      const rs = rowState(r)
                      return (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <span className="text-ink">{r.productName ?? r.rawName}</span>
                          <span className="num text-ink-soft">
                            {r.qty !== undefined ? fmtQty(r.qty) : r.rawQty} {r.entryUnit ?? r.unit ?? r.rawUnit}
                          </span>
                          {rs !== 'ready' && <Badge color={badgeColor(rs)}>{rowStateText(rs, t)}</Badge>}
                          {editable && !placed && (
                            <button type="button" className="text-xs text-brand" onClick={() => setResolving(r)}>
                              {t('แก้ไข')}
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {order && (
                    <Button variant="secondary" onClick={() => void viewOrder(order.id)}>
                      <Icon name="eye" size={16} />
                      {t('ดูรูป')}
                    </Button>
                  )}
                  {order && !placed && state === 'ready' && (
                    <Button onClick={() => void approve(g.supplierId)} disabled={!!busy}>
                      {t('อนุมัติ')}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
        {batch.groups.length === 0 && (
          <EmptyState icon="users" title={t('ยังไม่มีผู้ขายที่พร้อม')} hint={t('แก้ไขรายการด้านล่างก่อน')} />
        )}
      </div>

      {/* ---- what still needs a person ---- */}
      {orphanRows.length > 0 && (
        <Card className="p-4">
          <SectionHeader
            icon="warning"
            title={t('ต้องตรวจ ({n})', { n: orphanRows.length })}
            description={t('ระบบไม่เดาผู้ขาย — รายการเหล่านี้จะไม่อยู่ในใบสั่งซื้อจนกว่าจะแก้')}
          />
          <ul className="divide-y divide-line">
            {orphanRows.map((r) => {
              const rs = rowState(r)
              return (
                <li key={r.idx} className="flex flex-wrap items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="num text-xs text-ink-faint">{t('แถว {row}', { row: r.excelRow })}</span>
                      <span className="font-medium text-ink">{r.rawName}</span>
                      <span className="num text-ink-soft">
                        {r.rawQty} {r.rawUnit}
                      </span>
                      <Badge color={badgeColor(rs)}>{rowStateText(rs, t)}</Badge>
                    </div>
                    <ul className="mt-1 text-xs text-ink-soft">
                      {openIssues(r).map((i) => (
                        <li key={i.code}>• {issueText(i, t)}</li>
                      ))}
                    </ul>
                  </div>
                  {editable && (
                    <Button onClick={() => setResolving(r)} disabled={!!busy}>
                      {t('แก้ไข')}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {skippedRows.length > 0 && (
        <Card className="p-4">
          <SectionHeader icon="eyeOff" title={t('ข้ามไว้ ({n})', { n: skippedRows.length })} />
          <ul className="divide-y divide-line text-sm">
            {skippedRows.map((r) => (
              <li key={r.idx} className="flex items-center gap-3 py-1.5">
                <span className="flex-1 text-ink-soft">
                  {r.rawName} · {r.rawQty} {r.rawUnit}
                </span>
                {editable && (
                  <button type="button" className="text-xs text-brand" onClick={() => void restore(r)}>
                    {t('นำกลับมา')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---- the big buttons ---- */}
      {batch.status !== 'cancelled' && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {editable && (isAdmin || placedOrders.length === 0) && (
              <Button variant="secondary" onClick={() => void cancel()} disabled={!!busy}>
                {t('ยกเลิกชุด')}
              </Button>
            )}
            {editable && readyGroups.some((g) => !placedOrders.some((o) => o.id === g.poId)) && (
              <Button onClick={() => void approve()} disabled={!!busy}>
                <Icon name="check" size={16} />
                {t('อนุมัติทั้งหมดที่พร้อม ({n})', {
                  n: readyGroups.filter((g) => !placedOrders.some((o) => o.id === g.poId)).length,
                })}
              </Button>
            )}
            {placedOrders.length > 0 && (
              <Button onClick={() => setSending(true)} disabled={!!busy}>
                <Icon name="share" size={16} />
                {unsent.length > 0
                  ? t('ส่ง LINE ทั้งหมด ({n})', { n: unsent.length })
                  : t('ดูสรุปการส่ง')}
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* ---- who did what ---- */}
      <Card className="p-4">
        <SectionHeader icon="history" title={t('ประวัติ')} />
        <ul className="space-y-1 text-xs text-ink-soft">
          {[...batch.history].reverse().map((h, i) => (
            <li key={i}>
              {formatThaiDateTime(h.at)} · {h.byName} · {historyText(h.action, t)}
              {h.detail ? ` — ${h.detail}` : ''}
            </li>
          ))}
        </ul>
      </Card>

      {resolving && ctx && (
        <ResolveRowModal
          row={resolving}
          suppliers={suppliers}
          aliases={aliases}
          onClose={() => setResolving(null)}
          onSave={resolved}
        />
      )}
      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={t('ใบสั่งซื้อ {docNo}', { docNo: viewing.docNo })}>
          <PoSheet order={viewing} locationName={locationById(viewing.locationId)?.name ?? ''} company={company} />
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" onClick={() => setViewing(null)}>
              {t('ปิด')}
            </Button>
          </div>
        </Modal>
      )}
      {sending && (
        <SendWizard
          orders={placedOrders}
          onStatus={onSendStatus}
          onClose={() => {
            setSending(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

function Stat({ label, value, tone = 'plain' }: { label: string; value: number; tone?: 'plain' | 'warn' | 'in' }) {
  const tones = { plain: 'text-ink', warn: 'text-warn', in: 'text-in' }
  return (
    <Card className="p-3">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`num text-2xl font-semibold ${tones[tone]}`}>{value}</div>
    </Card>
  )
}

