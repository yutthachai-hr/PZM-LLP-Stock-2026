import { useCallback, useEffect, useRef, useState } from 'react'
import { brandDef, type BrandId } from '../brand/brand'
import { Badge, Button, Card, Field, Input, Textarea } from '../components/ui'
import { useI18n } from '../i18n/I18nContext'
import { SUPPLIER_NAME_MAX, SUPPLIER_NOTE_MAX } from '../lib/supplierConfirmation'
import type { SupplierConfirmationStatus } from '../types'

/**
 * The supplier's page (5 Oct 2026): opened from the link that went out with the order
 * sheet, on a phone, inside LINE, by someone who has never seen this app. No sign-in — the
 * link is the credential, and the server checks it on every call.
 *
 * One job: say "yes, that date" or pick another. Opening the page changes nothing (link
 * previews open links too); only the buttons do. The link keeps working until the delivery
 * day, so a supplier can change their mind and every answer is kept on the order.
 */

interface View {
  brand: BrandId
  company: string
  supplierName: string
  docNo: string
  revision: number
  status: SupplierConfirmationStatus
  requestedDate: string | null
  confirmedDate: string | null
  effectiveDate: string | null
  pending: { date: string | null; note: string | null } | null
  rejection: { date: string | null; reason: string } | null
  note: string | null
  items: { name: string; qty: number; unit: string }[]
  maxPostponeDays: number
  today: string
  autoUntil: string | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; view: View }
  | { kind: 'error'; error: string; docNo?: string; company?: string }

type Outcome = 'confirmed' | 'changed' | 'pending'

const tokenFromPath = () => decodeURIComponent(location.pathname.replace(/^\/s\//, '').replace(/\/$/, ''))

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** `YYYY-MM-DD` as people read it, with the weekday: suppliers book trucks by weekday. */
function useDateLabel() {
  const { lang } = useI18n()
  return useCallback(
    (key: string | null | undefined) => {
      if (!key) return ''
      const [y, m, d] = key.split('-').map(Number)
      return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'th-TH', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(y, m - 1, d, 12)))
    },
    [lang],
  )
}

const ERRORS: Record<string, string> = {
  not_found: 'ลิงก์นี้ไม่ถูกต้อง หรือถูกแทนที่ด้วยลิงก์ใหม่แล้ว', // i18n-key
  expired: 'ลิงก์นี้หมดอายุแล้ว กรุณาติดต่อฝ่ายจัดซื้อ', // i18n-key
  closed: 'ใบสั่งซื้อนี้ปิดแล้ว (รับของแล้วหรือยกเลิก)', // i18n-key
  not_configured: 'ระบบยืนยันวันส่งยังไม่เปิดใช้งาน', // i18n-key
  past: 'เลือกวันที่ผ่านมาแล้วไม่ได้', // i18n-key
  tooFar: 'วันที่ไกลเกินไป กรุณาตรวจสอบอีกครั้ง', // i18n-key
  invalid: 'กรุณาเลือกวันที่', // i18n-key
  noRequestedDate: 'ใบสั่งซื้อนี้ไม่ได้ระบุวันส่ง กรุณาเลือกวันที่', // i18n-key
  full: 'มีการเปลี่ยนแปลงมากเกินไป กรุณาติดต่อฝ่ายจัดซื้อ', // i18n-key
  busy: 'มีคนกำลังบันทึกพร้อมกัน กรุณาลองอีกครั้ง', // i18n-key
  network: 'เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง', // i18n-key
}

const STATUS_BADGE: Record<SupplierConfirmationStatus, { label: string; color: 'amber' | 'green' | 'blue' | 'red' }> = {
  waiting: { label: 'รอยืนยันวันส่ง', color: 'amber' }, // i18n-key
  confirmed: { label: 'ยืนยันวันส่งแล้ว', color: 'green' }, // i18n-key
  changed: { label: 'เปลี่ยนวันส่งแล้ว', color: 'blue' }, // i18n-key
  pending_date_approval: { label: 'รอฝ่ายจัดซื้ออนุมัติวันใหม่', color: 'red' }, // i18n-key
}

async function call(token: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`/api/supplier/${encodeURIComponent(token)}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, body }
}

export function SupplierConfirmPage() {
  const { t, lang, setLang } = useI18n()
  const label = useDateLabel()
  const token = useRef(tokenFromPath()).current
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [mode, setMode] = useState<'choose' | 'pick'>('choose')
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ outcome: Outcome; date: string } | null>(null)
  // One id per answer: a retry after a dropped connection sends the same one, so the
  // server applies it once. A different answer gets a new id.
  const pendingId = useRef<{ key: string; id: string } | null>(null)
  const highlightAccept = new URLSearchParams(location.search).get('a') === 'accept'

  useEffect(() => {
    let alive = true
    call(token)
      .then(({ status, body }) => {
        if (!alive) return
        if (status === 200) setState({ kind: 'ready', view: body.view as View })
        else
          setState({
            kind: 'error',
            error: String(body.error ?? 'not_found'),
            docNo: body.docNo as string | undefined,
            company: body.company as string | undefined,
          })
      })
      .catch(() => alive && setState({ kind: 'error', error: 'network' }))
    return () => {
      alive = false
    }
  }, [token])

  const view = state.kind === 'ready' ? state.view : null

  // The brand's own colour, as the app shows it: a supplier serving both companies should
  // see at a glance which one is asking.
  useEffect(() => {
    if (!view) return
    const b = brandDef(view.brand)
    const root = document.documentElement.style
    root.setProperty('--brand-accent', b.accent)
    root.setProperty('--brand-accent-soft', b.accentSoft)
    root.setProperty('--brand-accent-vivid', b.accentVivid)
    document.title = `${view.docNo} · ${view.company}`
  }, [view])

  async function submit(action: 'accept' | 'propose') {
    if (!view) return
    if (action === 'propose' && !date) {
      setError('invalid')
      return
    }
    const key = JSON.stringify([action, action === 'propose' ? date : '', name.trim(), note.trim()])
    if (pendingId.current?.key !== key) pendingId.current = { key, id: newRequestId() }
    setBusy(true)
    setError(null)
    try {
      const { status, body } = await call(token, {
        method: 'POST',
        body: JSON.stringify({ action, date: action === 'propose' ? date : undefined, name, note, requestId: pendingId.current.id }),
      })
      if (status === 200) {
        const next = body.view as View
        setState({ kind: 'ready', view: next })
        const outcome = (body.outcome as Outcome | null) ?? (next.status === 'pending_date_approval' ? 'pending' : next.status === 'changed' ? 'changed' : 'confirmed')
        setDone({ outcome, date: (outcome === 'pending' ? next.pending?.date : next.confirmedDate) ?? '' })
        pendingId.current = null
        setMode('choose')
      } else if (status === 410 || status === 404) {
        setState({ kind: 'error', error: String(body.error ?? 'not_found') })
      } else {
        setError(String(body.error ?? 'network'))
      }
    } catch {
      setError('network')
    } finally {
      setBusy(false)
    }
  }

  const langToggle = (
    <button
      type="button"
      className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-soft"
      onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
    >
      {lang === 'th' ? 'EN' : 'ไทย' /* i18n-key */}
    </button>
  )

  if (state.kind === 'loading') {
    return (
      <Shell lang={langToggle}>
        <p className="py-16 text-center text-sm text-ink-faint">{t('กำลังโหลด...')}</p>
      </Shell>
    )
  }

  if (state.kind === 'error') {
    return (
      <Shell lang={langToggle}>
        <Card className="p-6 text-center">
          <p className="text-3xl" aria-hidden>
            📄
          </p>
          {state.docNo && (
            <p className="mt-2 text-sm text-ink-soft">
              {state.company} · {state.docNo}
            </p>
          )}
          <p className="mt-2 font-medium text-ink">{t(ERRORS[state.error] ?? ERRORS.not_found)}</p>
        </Card>
      </Shell>
    )
  }

  const v = state.view
  const badge = STATUS_BADGE[v.status]
  const canAccept = !!v.requestedDate && v.requestedDate >= v.today
  const autoHint = v.autoUntil
    ? t('เลือกได้ถึง {date} ระบบอัปเดตทันที — หลังจากนั้นต้องรอฝ่ายจัดซื้ออนุมัติ', { date: label(v.autoUntil) })
    : null
  const shareText = done
    ? done.outcome === 'pending'
      ? t('📅 {supplier} ขอเลื่อนส่ง {docNo} ({company}) เป็นวันที่ {date} — รอฝ่ายจัดซื้ออนุมัติ', {
          supplier: v.supplierName,
          docNo: v.docNo,
          company: v.company,
          date: label(done.date),
        })
      : t('✅ {supplier} ยืนยันส่งสินค้า {docNo} ({company}) วันที่ {date}', {
          supplier: v.supplierName,
          docNo: v.docNo,
          company: v.company,
          date: label(done.date),
        })
    : ''

  return (
    <Shell lang={langToggle}>
      <Card tone="raised" className="overflow-hidden">
        <div className="bg-brand px-4 py-3 text-white">
          <p className="text-xs opacity-90">{t('ใบสั่งซื้อจาก')}</p>
          <p className="text-lg font-bold leading-tight">{v.company}</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-4 py-3 text-sm">
          <dt className="text-ink-faint">{t('เลขที่ใบสั่งซื้อ')}</dt>
          <dd className="font-semibold text-ink">
            {v.docNo}
            {v.revision > 0 && <span className="ml-1 text-xs text-ink-faint">Rev.{v.revision}</span>}
          </dd>
          <dt className="text-ink-faint">{t('ผู้ขาย')}</dt>
          <dd className="text-ink">{v.supplierName}</dd>
          <dt className="text-ink-faint">{t('วันที่ขอให้ส่ง')}</dt>
          <dd className="font-semibold text-ink">{v.requestedDate ? label(v.requestedDate) : t('ไม่ระบุ')}</dd>
          <dt className="text-ink-faint">{t('สถานะ')}</dt>
          <dd>
            <Badge color={badge.color}>{t(badge.label)}</Badge>
          </dd>
          {v.confirmedDate && v.status !== 'waiting' && (
            <>
              <dt className="text-ink-faint">{t('วันส่งที่ยืนยัน')}</dt>
              <dd className="font-semibold text-in">{label(v.confirmedDate)}</dd>
            </>
          )}
          {v.pending?.date && (
            <>
              <dt className="text-ink-faint">{t('วันที่ขอเลื่อน')}</dt>
              <dd className="font-semibold text-warn">{label(v.pending.date)}</dd>
            </>
          )}
        </dl>
      </Card>

      {v.rejection && v.status !== 'pending_date_approval' && (
        <Card className="border-out/30 bg-out-soft p-4 text-sm">
          <p className="font-medium text-out">
            {t('ฝ่ายจัดซื้อไม่อนุมัติวันที่ {date}', { date: label(v.rejection.date) })}
          </p>
          {v.rejection.reason && <p className="mt-1 text-ink-soft">{v.rejection.reason}</p>}
          <p className="mt-1 text-ink-soft">{t('กรุณายืนยันวันที่ขอ หรือเลือกวันอื่น')}</p>
        </Card>
      )}

      {done && (
        <Card className="border-in/30 bg-in-soft p-4">
          <p className="font-semibold text-in">
            {done.outcome === 'pending'
              ? t('ส่งคำขอเลื่อนเป็นวันที่ {date} แล้ว — รอฝ่ายจัดซื้ออนุมัติ', { date: label(done.date) })
              : t('บันทึกวันส่ง {date} เรียบร้อย ขอบคุณครับ/ค่ะ', { date: label(done.date) })}
          </p>
          <a
            className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#06c755] px-4 text-sm font-medium text-white"
            href={`https://line.me/R/share?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noreferrer"
          >
            {t('แชร์การยืนยันเข้ากลุ่ม LINE')}
          </a>
          <p className="mt-2 text-xs text-ink-soft">{t('เปลี่ยนวันได้อีกจนถึงวันส่ง ผ่านลิงก์เดิมนี้')}</p>
        </Card>
      )}

      <Card className="p-4">
        <p className="mb-2 text-sm font-semibold text-ink">{t('รายการสินค้า ({n})', { n: v.items.length })}</p>
        <ul className="divide-y divide-line text-sm">
          {v.items.map((it, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0 break-words text-ink">{it.name}</span>
              <span className="shrink-0 font-semibold tabular-nums text-ink">
                {it.qty.toLocaleString()} <span className="font-normal text-ink-soft">{it.unit}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3 p-4">
        <p className="text-sm font-semibold text-ink">{t('ยืนยันวันจัดส่ง')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ชื่อผู้ยืนยัน (ไม่บังคับ)')}>
            <Input value={name} maxLength={SUPPLIER_NAME_MAX} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label={t('หมายเหตุ (ไม่บังคับ)')}>
            <Textarea rows={2} value={note} maxLength={SUPPLIER_NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        {mode === 'choose' ? (
          <div className="grid gap-2">
            {canAccept && (
              <Button
                variant="success"
                className={`min-h-12 text-base ${highlightAccept ? 'ring-2 ring-in/40 ring-offset-2' : ''}`}
                disabled={busy}
                onClick={() => submit('accept')}
              >
                ✅ {t('ยืนยันส่งวันที่ {date}', { date: label(v.requestedDate) })}
              </Button>
            )}
            <Button
              variant="secondary"
              className="min-h-12 text-base"
              disabled={busy}
              onClick={() => {
                setMode('pick')
                setDate(v.pending?.date ?? v.confirmedDate ?? v.requestedDate ?? v.today)
                setError(null)
              }}
            >
              📅 {t('เลือกวันส่งอื่น')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label={t('วันที่จะส่ง')} hint={autoHint ?? undefined}>
              <Input type="date" value={date} min={v.today} onChange={(e) => setDate(e.target.value)} className="text-base" />
            </Field>
            {date && v.autoUntil && date > v.autoUntil && (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                {t('วันที่นี้เกินช่วงที่ตกลง จะต้องรอฝ่ายจัดซื้ออนุมัติก่อน')}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => setMode('choose')}>
                {t('ย้อนกลับ')}
              </Button>
              <Button disabled={busy || !date} onClick={() => submit('propose')}>
                {t('ยืนยันวันที่เลือก')}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-out">{t(ERRORS[error] ?? ERRORS.network)}</p>}
        {busy && <p className="text-xs text-ink-faint">{t('กำลังบันทึก...')}</p>}
      </Card>
    </Shell>
  )
}

function Shell({ children, lang }: { children: React.ReactNode; lang: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-lg space-y-3 px-4 pb-10 pt-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink-soft">{t('ยืนยันวันส่งสินค้า')}</p>
          {lang}
        </div>
        {children}
      </div>
    </div>
  )
}
