import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { backend } from '../../backend'
import { getBrand } from '../../brand/brand'
import { Button, StatGroup, StatTile } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { startOfDay } from '../../lib/format'
import { listBatchesInRange, rowState } from '../../services/purchaseBatch'
import { COL, type PurchaseOrder } from '../../types'

/**
 * Today's automatic purchasing, on the dashboard.
 *
 * Four numbers, each a door: rows waiting on a person, orders approved and not yet sent,
 * orders LINE said went, and orders skipped or failed that still need someone. Reads
 * today's batches once when the dashboard opens (usually zero or one document) plus their
 * orders; nothing is subscribed, for the same reason nothing else on the purchase side is.
 */
export function PurchaseWidget() {
  const t = useT()
  const navigate = useNavigate()
  const [counts, setCounts] = useState<{ review: number; toSend: number; sent: number; stuck: number; batches: number } | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const from = startOfDay(Date.now())
        const batches = await listBatchesInRange(from, Date.now() + 86_400_000)
        const open = batches.filter((b) => b.status !== 'cancelled')
        let review = 0
        let toSend = 0
        let sent = 0
        let stuck = 0
        const db = backend.forBrand(getBrand())
        for (const b of open) {
          review += b.rows.filter((r) => !r.skipped && rowState(r) !== 'ready').length
          const orders = await db.getBy<PurchaseOrder>(COL.purchaseOrders, 'batchId', b.id)
          for (const o of orders) {
            if (o.status === 'draft' || o.status === 'cancelled') continue
            if (o.shareStatus === 'sent') sent++
            else if (o.shareStatus === 'skipped' || o.shareStatus === 'failed') stuck++
            else toSend++
          }
        }
        if (alive) setCounts({ review, toSend, sent, stuck, batches: open.length })
      } catch {
        if (alive) setCounts(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (!counts) return null

  const go = (filter: string) => () => navigate(filter ? `/purchase?filter=${filter}` : '/purchase')

  return (
    <StatGroup
      title={t('สั่งซื้ออัตโนมัติ วันนี้')}
      action={
        <Button variant="ghost" onClick={go('')}>
          {counts.batches === 0 ? t('นำเข้า Excel') : t('ดูทั้งหมด')}
        </Button>
      }
    >
      <button type="button" onClick={go('needsReview')} className="text-left">
        <StatTile icon="warning" tone={counts.review > 0 ? 'warn' : 'plain'} value={`${counts.review}`} label={t('ต้องตรวจ')} />
      </button>
      <button type="button" onClick={go('ready')} className="text-left">
        <StatTile icon="share" tone={counts.toSend > 0 ? 'brand' : 'plain'} value={`${counts.toSend}`} label={t('พร้อมส่ง')} />
      </button>
      <button type="button" onClick={go('sent')} className="text-left">
        <StatTile icon="check" tone="in" value={`${counts.sent}`} label={t('ส่งแล้ว')} />
      </button>
      <button type="button" onClick={go('failed')} className="text-left">
        <StatTile icon="x" tone={counts.stuck > 0 ? 'out' : 'plain'} value={`${counts.stuck}`} label={t('ยังไม่ส่ง')} />
      </button>
    </StatGroup>
  )
}

