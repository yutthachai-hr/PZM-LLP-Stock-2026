import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useBrand } from '../../brand/BrandContext'
import { brandDef } from '../../brand/brand'
import { DataTable, type Column } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { LedgerWindowNotice } from '../../components/LedgerWindowNotice'
import { describeEditChange, TYPE_LABEL } from '../../components/movements/labels'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, EmptyState, Field, Input, Select } from '../../components/ui'
import { useData } from '../../data/DataContext'
import { fetchRange as fetchEvents } from '../../data/eventCache'
import { orderCache } from '../../data/orderCache'
import { requestCache } from '../../data/requestCache'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { buildActivityLog, type ActivityArea, type ActivityEntry } from '../../lib/activityLog'
import { dateInputToMs, fmtQty, formatThaiDate, formatThaiDateTime, msToDateInput, todayMs } from '../../lib/format'
import { looseMatch } from '../../lib/search'
import type { PurchaseOrder, PurchaseRequest, StockEvent } from '../../types'
import { HISTORY_LABEL } from '../calendar/chips'
import { historyText } from '../requests/RequestReview'

/**
 * Every action in the system, in one list that nobody can edit from here — the audit
 * trail the owner asked for (20 Sep 2026). Read from the histories each record already
 * carries; see lib/activityLog.ts. Orders, requests and tasks come through the same
 * range caches the calendar uses, so a week already looked at costs nothing again.
 */

const AREA_LABEL: Record<ActivityArea, string> = {
  stock: 'สต๊อก', // i18n-key
  order: 'ใบสั่งซื้อ', // i18n-key
  request: 'รายการขอสั่งซื้อ', // i18n-key
  task: 'งาน', // i18n-key
}
const AREA_COLOR: Record<ActivityArea, 'green' | 'blue' | 'amber' | 'slate'> = {
  stock: 'green',
  order: 'blue',
  request: 'amber',
  task: 'slate',
}
const DAY = 86_400_000
const PREVIEW = 300

export function ActivityLog() {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const { brand } = useBrand()
  const { movements, locationById, ensureMovementsFrom } = useData()
  const company = brand ? brandDef(brand).name : ''

  const [fromStr, setFromStr] = useState(msToDateInput(todayMs() - 7 * DAY))
  const [toStr, setToStr] = useState(msToDateInput(todayMs()))
  const [area, setArea] = useState<'' | ActivityArea>('')
  const [search, setSearch] = useState('')
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [events, setEvents] = useState<StockEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')

  const from = fromStr ? dateInputToMs(fromStr) : todayMs() - 7 * DAY
  const to = (toStr ? dateInputToMs(toStr) : todayMs()) + DAY - 1

  useEffect(() => {
    ensureMovementsFrom(from)
  }, [from, ensureMovementsFrom])

  // An order placed before the window may have been received or cancelled inside it, and
  // a request may have moved weeks after it was written: reach back 60 days for those.
  useEffect(() => {
    let on = true
    setLoading(true)
    Promise.all([orderCache.fetchRange(from - 60 * DAY, to), requestCache.fetchRange(from - 60 * DAY, to), fetchEvents(from - 30 * DAY, to + 30 * DAY)])
      .then(([o, r, e]) => {
        if (!on) return
        setOrders(o)
        setRequests(r)
        setEvents(e)
      })
      .catch((e) => toast.error(errText(e, t)))
      .finally(() => on && setLoading(false))
    return () => {
      on = false
    }
    // toast/t are stable for the page's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  const entries = useMemo(
    () =>
      buildActivityLog({
        movements,
        orders,
        requests,
        events,
        from,
        to,
        locationName: (id) => (id ? (locationById(id)?.name ?? id) : ''),
        formatDate: formatThaiDate,
        formatDateTime: formatThaiDateTime,
        fmtQty,
        movementType: (type) => t(TYPE_LABEL[type]),
        editChange: (c) => describeEditChange(c, t, formatThaiDate, (id) => locationById(id)?.name ?? ''),
        requestAction: (a) => historyText(a, t),
        taskAction: (a) => t(HISTORY_LABEL[a as keyof typeof HISTORY_LABEL] ?? a),
        t,
      }),
    [movements, orders, requests, events, from, to, locationById, t],
  )

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => (area ? e.area === area : true)).filter((e) => (q ? looseMatch([e.docNo, e.subject, e.detail, e.by, e.action], q) : true))
  }, [entries, area, search])

  const columns = useMemo<Column<ActivityEntry>[]>(
    () => [
      { key: 'at', header: t('เวลา'), className: 'whitespace-nowrap text-xs text-ink-soft', cell: (e) => formatThaiDateTime(e.at) },
      {
        key: 'area',
        header: t('ส่วน'),
        cell: (e) => (
          <span className="inline-flex flex-wrap items-center gap-1">
            <Badge color={AREA_COLOR[e.area]}>{t(AREA_LABEL[e.area])}</Badge>
            <span className="text-xs text-ink-soft">{e.kind}</span>
          </span>
        ),
      },
      { key: 'docNo', header: t('เลขที่'), className: 'doc-no whitespace-nowrap text-xs', cell: (e) => (e.link ? <Link to={e.link} className="text-brand hover:underline">{e.docNo || t('เปิด')}</Link> : e.docNo) },
      { key: 'action', header: t('การกระทำ'), primary: true, className: 'font-medium text-ink', cell: (e) => e.action },
      { key: 'subject', header: t('รายการ'), className: 'text-sm', cell: (e) => e.subject },
      { key: 'detail', header: t('รายละเอียด'), className: 'text-xs text-ink-soft', cell: (e) => <span className="whitespace-pre-line">{e.detail}</span> },
      { key: 'by', header: t('โดย'), className: 'text-xs whitespace-nowrap', cell: (e) => e.by },
    ],
    [t],
  )

  const rowsForFile = () =>
    shown.map((e) => ({
      [t('เวลา')]: formatThaiDateTime(e.at),
      [t('ส่วน')]: t(AREA_LABEL[e.area]),
      [t('ประเภท')]: e.kind,
      [t('เลขที่')]: e.docNo,
      [t('การกระทำ')]: e.action,
      [t('รายการ')]: e.subject,
      [t('รายละเอียด')]: e.detail,
      [t('โดย')]: e.by,
    }))

  async function excel() {
    setBusy('excel')
    try {
      const { exportExcel } = await import('../../lib/export')
      exportExcel(t('บันทึกกิจกรรม_{ts}', { ts: Date.now() }), 'Activity', rowsForFile())
    } catch (e) {
      toast.error(t('สร้างไฟล์ไม่สำเร็จ:') + ' ' + errText(e, t))
    } finally {
      setBusy('')
    }
  }

  async function pdf() {
    setBusy('pdf')
    try {
      const { exportReportPdf } = await import('../../lib/export')
      const rows = rowsForFile()
      const head = rows.length ? Object.keys(rows[0]) : []
      exportReportPdf({
        filename: t('บันทึกกิจกรรม_{ts}', { ts: Date.now() }),
        title: t('บันทึกกิจกรรมทั้งระบบ — {company}', { company }),
        meta: [
          t('ช่วงวันที่: {range}', { range: `${formatThaiDate(from)} - ${formatThaiDate(to)}` }),
          area ? t(AREA_LABEL[area]) : t('ทุกส่วน'),
          t('ออกรายงานโดย: {user} เมื่อ {when}', { user: user?.name ?? '', when: formatThaiDateTime(Date.now()) }),
        ],
        head,
        body: rows.map((r) => head.map((h) => r[h])),
      })
    } catch (e) {
      toast.error(t('สร้างไฟล์ไม่สำเร็จ:') + ' ' + errText(e, t))
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <Card className="space-y-4 p-4">
        <p className="text-sm text-ink-soft">
          {t('ทุกการกระทำในระบบ — บันทึก แก้ไข ยกเลิก อนุมัติ รับของ — เรียงตามเวลา อ่านและดาวน์โหลดได้ แก้ไขไม่ได้')}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('ตั้งแต่วันที่')}>
            <Input type="date" value={fromStr} onChange={(e) => setFromStr(e.target.value)} />
          </Field>
          <Field label={t('ถึงวันที่')}>
            <Input type="date" value={toStr} onChange={(e) => setToStr(e.target.value)} />
          </Field>
          <Field label={t('ส่วน')}>
            <Select value={area} onChange={(e) => setArea(e.target.value as '' | ActivityArea)}>
              <option value="">{t('ทุกส่วน')}</option>
              {(Object.keys(AREA_LABEL) as ActivityArea[]).map((k) => (
                <option key={k} value={k}>
                  {t(AREA_LABEL[k])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('ค้นหา')}>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('เลขที่ / สินค้า / ผู้ทำ')} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-sm text-ink-soft">{loading ? t('กำลังโหลดข้อมูล...') : t('พบ {n} รายการ', { n: shown.length })}</span>
          <div className="flex gap-2">
            <Button variant="success" onClick={excel} disabled={shown.length === 0 || loading || !!busy}>
              {busy === 'excel' ? (
                t('กำลังสร้างไฟล์...')
              ) : (
                <>
                  <Icon name="download" size={16} />
                  Excel
                </>
              )}
            </Button>
            <Button variant="danger" onClick={pdf} disabled={shown.length === 0 || loading || !!busy}>
              {busy === 'pdf' ? (
                t('กำลังสร้างไฟล์...')
              ) : (
                <>
                  <Icon name="download" size={16} />
                  PDF
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      <LedgerWindowNotice />

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon="history" title={t('ไม่พบรายการ')} hint={t('ลองปรับตัวกรอง')} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable rows={shown.slice(0, PREVIEW)} columns={columns} rowKey={(e) => e.key} minWidth={1000} maxHeight="calc(100vh - 300px)" />
          {shown.length > PREVIEW && (
            <div className="border-t border-line p-2 text-center text-xs text-ink-faint">
              {t('แสดงตัวอย่าง — ไฟล์ดาวน์โหลดจะมีครบทั้ง {n} รายการ', { n: shown.length })}
            </div>
          )}
        </Card>
      )}
    </>
  )
}
