import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { Icon, type IconName } from '../../components/Icon'
import { SiteChip } from '../../components/SiteChip'
import { useToast } from '../../components/Toast'
import { AlertBanner, Badge, Button, EmptyState, Field, Input, Modal, Select, Spinner, Textarea } from '../../components/ui'
import { FramePage, PageHero, StatRow, StatTile, frameCard } from '../../components/frame'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { fmtQty, formatThaiDateShort } from '../../lib/format'
import { bkkDayStart } from '../../lib/inventoryRules/time'
import { arrivalsFor, type ArrivalCard } from '../../lib/transferFigures'
import { TRANSFER_STATUS_KEYS, canUserAccessBranch, transferBadgeColor } from '../../lib/transferStatus'
import { listOpenTransfers, listTransfersInRange, reportableQty, reportMisroute } from '../../services/transfers'
import type { Transfer } from '../../types'

/**
 * รายการส่งของวันนี้ — what is coming to the branches this person works at, what they are
 * checking, what has a problem, and what they received today.
 *
 * Read once when opened: every open document by status, plus the last few days for "received
 * today". Nothing is subscribed.
 *
 * "พบสินค้าส่งผิดสาขา" is here because the branch that has the goods is the one that knows:
 * they pick the delivery the goods belong to and say how many. The goods stay in transit —
 * not this branch's stock — until a manager decides.
 */

const CARDS: { key: ArrivalCard; label: string; icon: IconName; tone: 'blue' | 'amber' | 'red' | 'green' }[] = [
  { key: 'coming', label: 'กำลังมา', icon: 'truck', tone: 'blue' }, // i18n-key
  { key: 'receiving', label: 'รอตรวจรับ', icon: 'receive', tone: 'amber' }, // i18n-key
  { key: 'problem', label: 'มีปัญหา', icon: 'alertCircle', tone: 'red' }, // i18n-key
  { key: 'received', label: 'รับแล้ววันนี้', icon: 'checkCircle', tone: 'green' }, // i18n-key
]

export function TransfersTodayPage() {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { locations } = useData()
  const [rows, setRows] = useState<Transfer[] | null>(null)
  const [card, setCard] = useState<ArrivalCard>('coming')
  const [reporting, setReporting] = useState(false)

  const actor = useMemo(() => (user ? { id: user.id, name: user.name, role: user.role, siteIds: user.siteIds } : null), [user])
  const mySites = useMemo(() => locations.filter((l) => l.active !== false && canUserAccessBranch(actor ?? undefined, l.id)), [locations, actor])
  const scoped = user?.siteIds && user.siteIds.length > 0 && user.role === 'staff' ? user.siteIds : null

  const load = useCallback(async () => {
    try {
      const now = Date.now()
      const [open, recent] = await Promise.all([listOpenTransfers(), listTransfersInRange(bkkDayStart(now) - 7 * 86_400_000, now)])
      const byId = new Map([...recent, ...open].map((r) => [r.id, r]))
      setRows([...byId.values()])
    } catch (e) {
      toast.error(errText(e, t))
      setRows([])
    }
  }, [toast, t])

  useEffect(() => {
    void load()
  }, [load])

  const cards = useMemo(() => arrivalsFor(rows ?? [], scoped), [rows, scoped])
  const shown = cards[card]

  return (
    <FramePage>
      <PageHero
        icon="truck"
        tone="in"
        title={t('รายการส่งของวันนี้')}
        subtitle={
          scoped ? (
            <span className="inline-flex flex-wrap gap-1">
              {scoped.map((id) => (
                <SiteChip key={id} locationId={id} />
              ))}
            </span>
          ) : (
            t('ทุกสาขา')
          )
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setReporting(true)}>
              <Icon name="warning" size={16} />
              {t('พบสินค้าส่งผิดสาขา')}
            </Button>
            <Button variant="outline" onClick={() => void load()}>
              <Icon name="refresh" size={16} />
              <span className="hidden sm:inline">{t('โหลดใหม่')}</span>
            </Button>
          </>
        }
      />

      <StatRow columns={4}>
        {CARDS.map((c) => (
          <StatTile
            key={c.key}
            icon={c.icon}
            tone={c.tone}
            label={t(c.label)}
            value={cards[c.key].length}
            unit={t('ใบ')}
            onClick={() => setCard(c.key)}
            selected={card === c.key}
          />
        ))}
      </StatRow>

      {rows === null ? (
        <Spinner label={t('กำลังโหลด...')} />
      ) : shown.length === 0 ? (
        <div className={frameCard}>
          <EmptyState icon="truck" title={t('ไม่มีรายการในหมวดนี้')} />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((tr) => {
            const lines = tr.items.filter((i) => !i.removed)
            const receivable = (tr.status === 'inTransit' || tr.status === 'receiving') && canUserAccessBranch(actor ?? undefined, tr.toLocationId)
            return (
              <div key={tr.id} className={`${frameCard} space-y-2 p-4`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/transfers/${tr.id}`} className="doc-no font-semibold text-brand underline">
                    {tr.docNo}
                  </Link>
                  <Badge color={transferBadgeColor(tr.status) === 'purple' ? 'blue' : (transferBadgeColor(tr.status) as 'slate')}>{t(TRANSFER_STATUS_KEYS[tr.status])}</Badge>
                  <span className="ml-auto text-xs text-ink-faint">{formatThaiDateShort(tr.dispatchDate)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <SiteChip locationId={tr.fromLocationId} />
                  <Icon name="arrowRight" size={14} />
                  <SiteChip locationId={tr.toLocationId} />
                </div>
                <ul className="text-sm text-ink-soft">
                  {lines.slice(0, 4).map((i) => (
                    <li key={i.idx} className="flex justify-between gap-2">
                      <span className="truncate">{i.productName}</span>
                      <span className="num">
                        {fmtQty(i.dispatchQty)} {i.unit}
                      </span>
                    </li>
                  ))}
                  {lines.length > 4 && <li>{t('และอีก {n} รายการ', { n: lines.length - 4 })}</li>}
                </ul>
                {receivable && (
                  <Button className="w-full" onClick={() => navigate(`/transfers/${tr.id}/receive`)}>
                    <Icon name="receive" size={16} />
                    {t('ตรวจรับสินค้า')}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {reporting && actor && (
        <ReportFound
          rows={rows ?? []}
          sites={mySites}
          actor={actor}
          onClose={() => setReporting(false)}
          onDone={() => {
            setReporting(false)
            void load()
          }}
        />
      )}
    </FramePage>
  )
}

/** "These goods were meant for another branch": which delivery, which product, how many. */
function ReportFound({
  rows,
  sites,
  actor,
  onClose,
  onDone,
}: {
  rows: Transfer[]
  sites: { id: string; name: string }[]
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'staff'; siteIds?: string[] }
  onClose: () => void
  onDone: () => void
}) {
  const t = useT()
  const toast = useToast()
  const { locationById } = useData()
  const [site, setSite] = useState(sites[0]?.id ?? '')
  const [docId, setDocId] = useState('')
  const [idx, setIdx] = useState<number | null>(null)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Deliveries still on the road to somewhere else.
  const candidates = rows.filter(
    (r) => r.toLocationId !== site && ['inTransit', 'receiving', 'discrepancy', 'pendingDiscrepancyApproval'].includes(r.status) && r.items.some((i) => reportableQty(i) > 0),
  )
  const doc = candidates.find((r) => r.id === docId)
  const line = doc?.items.find((i) => i.idx === idx)
  const room = line ? reportableQty(line) : 0

  async function save() {
    if (!doc || !line) return
    setBusy(true)
    try {
      await reportMisroute({ transferId: doc.id, itemIdx: line.idx, actualCustodyLocationId: site, qty: Number(qty), actor, note: note.trim() || undefined })
      toast.success(t('บันทึกแล้ว — สินค้ายังไม่เข้าสต๊อกสาขานี้จนกว่าหัวหน้าจะตัดสิน'))
      onDone()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('พบสินค้าส่งผิดสาขา')}>
      <div className="space-y-3">
        <AlertBanner tone="info" icon="info">
          {t('ของยังนับเป็น "ระหว่างขนส่ง" ไม่เพิ่มเข้าสต๊อกขายของสาขานี้ หัวหน้าจะเลือกให้เก็บไว้ ส่งต่อ หรือส่งกลับ')}
        </AlertBanner>
        <Field label={t('สาขาที่พบสินค้า')} required>
          <Select value={site} onChange={(e) => { setSite(e.target.value); setDocId(''); setIdx(null) }}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('เป็นของเอกสารใบไหน')} required>
          <Select value={docId} onChange={(e) => { setDocId(e.target.value); setIdx(null) }}>
            <option value="">{t('— เลือก —')}</option>
            {candidates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.docNo} · {locationById(r.fromLocationId)?.name} → {locationById(r.toLocationId)?.name}
              </option>
            ))}
          </Select>
        </Field>
        {doc && (
          <Field label={t('สินค้า')} required>
            <Select value={idx ?? ''} onChange={(e) => setIdx(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">{t('— เลือก —')}</option>
              {doc.items
                .filter((i) => reportableQty(i) > 0)
                .map((i) => (
                  <option key={i.idx} value={i.idx}>
                    {i.productName} ({t('ค้าง {qty} {unit}', { qty: fmtQty(reportableQty(i)), unit: i.unit })})
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {line && (
          <Field label={t('จำนวนที่พบ ({unit})', { unit: line.unit })} required hint={t('ไม่เกิน {qty}', { qty: fmtQty(room) })}>
            <Input type="number" inputMode="decimal" min={0} max={room} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        )}
        <Field label={t('หมายเหตุ')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('เช่น ติดมากับรถรอบเช้า')} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('ยกเลิก')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !line || !(Number(qty) > 0) || Number(qty) > room}>
            {busy ? t('กำลังบันทึก...') : t('บันทึก')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
