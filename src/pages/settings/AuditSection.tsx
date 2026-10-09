import { useState } from 'react'
import { Button, Spinner } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { formatThaiDateTime } from '../../lib/format'
import { loadAuditPage } from '../../services/auditLog'
import type { AuditEntityType, AuditEntry } from '../../types'

const ENTITY_LABEL: Record<AuditEntityType, string> = {
  product: 'สินค้า', // i18n-key
  location: 'คลัง / สาขา', // i18n-key
  supplier: 'ผู้ขาย', // i18n-key
  supplierItem: 'ราคาผู้ขาย', // i18n-key
  unitConversion: 'หน่วยและอัตราแปลง', // i18n-key
  user: 'ผู้ใช้งาน', // i18n-key
  settings: 'ตั้งค่า', // i18n-key
  schedule: 'ตารางนับสต๊อก', // i18n-key
  companyProfile: 'ข้อมูลบริษัท', // i18n-key
  maintenance: 'ซ่อมบำรุงข้อมูล', // i18n-key
  movement: 'รายการเคลื่อนไหว', // i18n-key
  purchaseOrder: 'ใบสั่งซื้อ', // i18n-key
  backup: 'กู้คืนข้อมูล', // i18n-key
}

const value = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/**
 * B2: the audit log, newest first, 50 at a time. Read only when asked and a page per click —
 * never a listener — and read-only: the rules refuse any change to an entry, an admin's too.
 */
export function AuditSection() {
  const t = useT()
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [more, setMore] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [type, setType] = useState<AuditEntityType | ''>('')

  async function next() {
    setBusy(true)
    setError(null)
    try {
      const page = await loadAuditPage(rows.at(-1)?.createdAt)
      setRows((cur) => [...cur, ...page.rows])
      setMore(page.more)
      setLoaded(true)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const shown = type ? rows.filter((r) => r.entityType === type) : rows
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft">
        {t('ทุกการแก้ไขสินค้า คลัง ผู้ขาย หน่วย ผู้ใช้ ตั้งค่า และงานซ่อมบำรุงข้อมูล — ใครทำ เมื่อไร ก่อน/หลัง ประวัตินี้แก้หรือลบไม่ได้')}
      </p>
      {!loaded && (
        <Button onClick={() => void next()} disabled={busy}>
          {t('ดูประวัติการแก้ไข')}
        </Button>
      )}
      {loaded && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-soft">{t('เรื่อง')}</span>
          <select className="rounded-lg border border-line bg-surface px-2 py-1" value={type} onChange={(e) => setType(e.target.value as AuditEntityType | '')}>
            <option value="">{t('ทั้งหมด')}</option>
            {(Object.keys(ENTITY_LABEL) as AuditEntityType[]).map((k) => (
              <option key={k} value={k}>
                {t(ENTITY_LABEL[k])}
              </option>
            ))}
          </select>
        </label>
      )}
      {error != null && <p className="text-sm text-danger">{errText(error, t)}</p>}
      {loaded && shown.length === 0 && !busy && <p className="text-sm text-ink-soft">{t('ยังไม่มีรายการ')}</p>}
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface" data-testid="audit-list">
        {shown.map((r) => {
          const keys = [...new Set([...Object.keys(r.before ?? {}), ...Object.keys(r.after ?? {})])]
          return (
            <li key={r.id} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-ink">{r.action}</span>
                <span className="text-ink-soft">
                  {t(ENTITY_LABEL[r.entityType] ?? r.entityType)} · {r.entityId}
                </span>
                <span className="ml-auto text-xs text-ink-soft">{formatThaiDateTime(r.createdAt)}</span>
              </div>
              <div className="text-xs text-ink-soft">
                {r.actorName} ({r.actorRole})
              </div>
              {keys.length > 0 && (
                <ul className="text-xs">
                  {keys.map((k) => (
                    <li key={k}>
                      <span className="text-ink-soft">{k}:</span> {value(r.before?.[k])} → {value(r.after?.[k])}
                    </li>
                  ))}
                </ul>
              )}
              {r.reason && (
                <div className="text-xs">
                  {t('เหตุผล')}: {r.reason}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {busy && <Spinner />}
      {loaded && more && (
        <Button variant="secondary" onClick={() => void next()} disabled={busy}>
          {t('โหลดเพิ่มอีก 50 รายการ')}
        </Button>
      )}
    </div>
  )
}
