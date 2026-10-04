import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useBrand } from '../../brand/BrandContext'
import { brandDef } from '../../brand/brand'
import { buildDigest, digestFlex, digestText } from '../../lib/dailyDigest'
import { shortages } from '../../lib/inventoryRules/lowStock'
import { pickShareProvider } from '../../share'
import { DIGEST_PARAM } from '../../share/liffResume'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useCalendarFeed } from '../../data/useCalendarFeed'
import { requestCache } from '../../data/requestCache'
import { transferCache } from '../../data/transferCache'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { fmtQty, formatThaiDate } from '../../lib/format'
import { bkkDayEnd, bkkDayKey, bkkDayStart, DAY_MS, isSameBkkDay } from '../../lib/inventoryRules/time'
import {
  dailySuggestions,
  tickedByDefault,
  TRANSFER_LEAD_DAYS,
  type SuggestionLine,
} from '../../lib/inventoryRules/suggestions'
import { useScheduleConfig } from '../../services/schedules'
import { useSuppliers } from '../../services/suppliers'
import * as PR from '../../services/purchaseRequests'
import { createDraft, listOpenTransfers, saveItems } from '../../services/transfers'
import type { Role, StockLocation, Transfer, TransferItem } from '../../types'
import { SectionCard, StatusChip } from '../frame'
import { Icon } from '../Icon'
import { useToast } from '../Toast'
import { Button, Input, Modal } from '../ui'
import { shortSiteName, siteNumber } from '../../lib/siteTone'

/** How many lines a block shows before "see all". */
const FOLD = 8

/** Written on the draft as data — the same words whichever language the screen is in. */
const SUGGESTED_NOTE = 'จากข้อเสนอแนะประจำวัน' // i18n-key

type Key = string
const keyOf = (blockId: string, productId: string): Key => `${blockId}__${productId}`

/**
 * ข้อเสนอแนะประจำวัน (Master Automation Plan, Phase 1 — owner, 25 Sep 2026).
 *
 * Every reorder suggestion of the day in one place: what the warehouse should buy, as one
 * purchase request for the หัวหน้า's review, and what each branch should be sent from the
 * warehouse, as one transfer request. The numbers are the calendar's own (same insights);
 * the calendar's per-product entries and their "ขอสั่งซื้อ" button stay exactly as they
 * were — the owner compares the two before anything old changes.
 *
 * Nothing is written until a button is pressed, and a pressed button only drafts: the
 * request goes through submit → approve → orders, the transfer through its own review.
 */
export function DailySuggestions() {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const data = useData()
  const suppliers = useSuppliers()
  const config = useScheduleConfig()
  const [now] = useState(() => Date.now())
  const range = useMemo(() => ({ from: bkkDayStart(now), to: bkkDayEnd(now) }), [now])
  // The calendar's reads, through the caches the calendar and the bell already share.
  const feed = useCalendarFeed(range, now)

  // Open transfers: every status in flight (one equality read each) plus the last two weeks,
  // which is where a draft someone just made lives. Once per visit.
  const [openTransfers, setOpenTransfers] = useState<Transfer[] | null>(null)
  useEffect(() => {
    let live = true
    Promise.all([listOpenTransfers(), transferCache.fetchRange(bkkDayStart(now) - 14 * DAY_MS, bkkDayEnd(now))])
      .then(([open, recent]) => {
        if (live) setOpenTransfers([...new Map([...recent, ...open].map((x) => [x.id, x])).values()])
      })
      .catch(() => live && setOpenTransfers([]))
    return () => {
      live = false
    }
  }, [now])

  const suggestions = useMemo(() => {
    if (!feed.insights || openTransfers === null) return null
    return dailySuggestions({
      reorders: feed.insights.reorders,
      locations: data.locations,
      qtyAt: data.qtyAt,
      minFor: data.minFor,
      coverDays: config.settings.coverDays,
      openTransfers,
    })
  }, [feed.insights, openTransfers, data.locations, data.qtyAt, data.minFor, config.settings.coverDays])

  // What the หัวหน้า changed on the card: a tick, a quantity. Everything else is the suggestion.
  const [ticked, setTicked] = useState<Record<Key, boolean>>({})
  const [qty, setQty] = useState<Record<Key, string>>({})
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  // Which site's list is open in its window (owner, 4 Oct 2026: the card took most of
  // the dashboard; one round icon per site now, its list opened on a tap).
  const [showing, setShowing] = useState<string | null>(null)

  const actor = user ? { id: user.id, name: user.name, role: user.role as Role, siteIds: user.siteIds } : null
  const { brand } = useBrand()
  const [params, setParams] = useSearchParams()

  /**
   * The morning digest into a LINE group (Automation Plan Phase 5): LINE Personal through
   * the LIFF picker, a Flex card whose rows open the page where each job is done. Where LIFF
   * is not available, the phone's share sheet (or the clipboard) gets the same as text.
   */
  async function shareDigest() {
    if (!suggestions) return
    const open = (i: (typeof feed.items)[number]) => i.status === 'pending' || i.status === 'inProgress' || i.status === 'waitingApproval' || i.status === 'overdue'
    const low = shortages({ products: data.products, locations: data.locations, qtyAt: data.qtyAt, minFor: data.minFor, tracksProduct: data.tracksProduct })
      .sort((a, b) => a.qty / a.min - b.qty / b.min)
    const lowNames = [...new Set(low.map((s) => s.product.name))]
    const digest = buildDigest(
      {
        brandName: brand ? brandDef(brand).name : '',
        dateText: formatThaiDate(now),
        arrivingToday: feed.items.filter((i) => i.kind === 'poExpected' && isSameBkkDay(i.at, now) && open(i)).length,
        lateOrders: feed.items.filter((i) => i.kind === 'poExpected' && i.status === 'overdue').length,
        pendingRequests: feed.items.filter((i) => i.kind === 'prPending').length,
        pendingTransfers: (openTransfers ?? []).filter((x) => x.status === 'pendingApproval').length,
        transfersOnTheWay: (openTransfers ?? []).filter((x) => x.status === 'inTransit' || x.status === 'receiving').length,
        lowStock: new Set(low.map((s) => s.product.id)).size,
        lowNames,
        suggestedLines: blocks.reduce((n, b) => n + b.lines.filter(tickedByDefault).length, 0),
      },
      t,
    )
    const origin = window.location.origin
    setBusy('digest')
    try {
      const provider = await pickShareProvider()
      const outcome = await provider.share({
        subject: { kind: 'digest', id: bkkDayKey(now) },
        caption: digestText(digest, origin, t),
        flex: digestFlex(digest, origin),
      })
      if (outcome === 'sent') toast.success(t('ส่งสรุปเข้า LINE แล้ว'))
      else if (outcome === 'shareOpened') toast.success(provider.id === 'web-share' && typeof navigator.share !== 'function' ? t('คัดลอกสรุปแล้ว — วางในกลุ่ม LINE ได้เลย') : t('เปิดหน้าแชร์แล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  // Back from LINE Login with ?digest=: pick the share up where it was left, once.
  const resumed = useRef(false)
  useEffect(() => {
    if (resumed.current || !suggestions || !params.get(DIGEST_PARAM)) return
    resumed.current = true
    const next = new URLSearchParams(params)
    next.delete(DIGEST_PARAM)
    setParams(next, { replace: true })
    void shareDigest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, params])
  const isOn = (k: Key, l: SuggestionLine) => ticked[k] ?? tickedByDefault(l)
  const qtyOf = (k: Key, l: SuggestionLine) => {
    const v = qty[k]
    return v === undefined ? l.qty : Number(v)
  }

  function chosen(blockId: string, lines: SuggestionLine[]) {
    return lines.filter((l) => isOn(keyOf(blockId, l.product.id), l)).map((l) => ({ line: l, qty: qtyOf(keyOf(blockId, l.product.id), l) }))
  }

  async function draftRequest(location: StockLocation, lines: SuggestionLine[]) {
    if (!actor) return
    const picked = chosen(location.id, lines)
    const bad = picked.find((p) => !(p.qty > 0) || !p.line.supplierId)
    if (bad) return toast.error(bad.line.supplierId ? t('จำนวนของ "{name}" ต้องมากกว่า 0', { name: bad.line.product.name }) : t('"{name}" ยังไม่มีผู้ขาย — เอาออก หรือกำหนดผู้ขายที่หน้าสินค้าก่อน', { name: bad.line.product.name }))
    setBusy(`pr-${location.id}`)
    try {
      const pr = await PR.createRequest({ locationId: location.id, note: SUGGESTED_NOTE, actor })
      const filled = await PR.addItems({
        id: pr.id,
        lines: picked.map((p) => ({ productId: p.line.product.id, supplierId: p.line.supplierId!, qty: p.qty })),
        products: data.products,
        suppliers,
        actor,
      })
      requestCache.patch(filled)
      toast.success(t('สร้างร่าง {docNo} แล้ว ({n} รายการ)', { docNo: filled.docNo, n: filled.items.length }))
      navigate(`/requests/${filled.id}`)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  async function draftTransfer(from: StockLocation, to: StockLocation, lines: SuggestionLine[]) {
    if (!actor) return
    const blockId = `${from.id}>${to.id}`
    const picked = chosen(blockId, lines)
    const bad = picked.find((p) => !(p.qty > 0))
    if (bad) return toast.error(t('จำนวนของ "{name}" ต้องมากกว่า 0', { name: bad.line.product.name }))
    setBusy(`tr-${to.id}`)
    try {
      const draft = await createDraft({ fromLocationId: from.id, toLocationId: to.id, dispatchDate: now, note: SUGGESTED_NOTE, actor })
      const items: TransferItem[] = picked.map((p, idx) => ({
        idx,
        productId: p.line.product.id,
        productName: p.line.product.name,
        sku: p.line.product.sku,
        unit: p.line.product.unitType,
        requestedQty: p.qty,
        dispatchQty: p.qty,
      }))
      const saved = await saveItems(draft.id, items, actor)
      transferCache.patch(saved)
      setOpenTransfers((cur) => [...(cur ?? []), saved])
      toast.success(t('สร้างร่าง {docNo} แล้ว ({n} รายการ)', { docNo: saved.docNo, n: items.length }))
      navigate(`/transfers/${saved.id}`)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  const blocks = suggestions
    ? [
        ...suggestions.purchase.map((p) => ({
          id: p.location.id,
          title: t('{site} — ขอสั่งซื้อ', { site: p.location.name }),
          hint: t('สร้างเป็นร่างใบขอสั่งซื้อใบเดียว ให้หัวหน้าตรวจและอนุมัติ แล้วแยกใบสั่งซื้อตามผู้ขายตามปกติ'),
          lines: p.lines,
          site: p.location,
          kind: 'pr' as const,
          action: t('สร้างร่างใบขอสั่งซื้อ ({n} รายการ)', { n: chosen(p.location.id, p.lines).length }),
          run: () => void draftRequest(p.location, p.lines),
          busyKey: `pr-${p.location.id}`,
        })),
        ...suggestions.transfers.map((x) => ({
          id: `${x.from.id}>${x.to.id}`,
          title: t('{from} → {to} — ขอโอน', { from: x.from.name, to: x.to.name }),
          hint: t('คิดว่าของจากคลังถึงสาขาใน {n} วัน และไม่เกินที่คลังมีอยู่', { n: TRANSFER_LEAD_DAYS }),
          lines: x.lines,
          site: x.to,
          kind: 'tr' as const,
          action: t('สร้างร่างใบขอโอน ({n} รายการ)', { n: chosen(`${x.from.id}>${x.to.id}`, x.lines).length }),
          run: () => void draftTransfer(x.from, x.to, x.lines),
          busyKey: `tr-${x.to.id}`,
        })),
      ]
    : []

  type Block = (typeof blocks)[number]

  /** One site's lines, the ticks and quantities, and the button that drafts them. */
  function blockBody(b: Block) {
    const all = open[b.id] ? b.lines : b.lines.slice(0, FOLD)
    const n = chosen(b.id, b.lines).length
    return (
      <div className="rounded-xl border border-line">
        <ul className="divide-y divide-line">
          {all.map((l) => {
            const k = keyOf(b.id, l.product.id)
            const on = isOn(k, l)
            return (
              <li key={k} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 md:grid-cols-[auto_minmax(0,1fr)_6rem_8rem_10rem]">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => setTicked((c) => ({ ...c, [k]: e.target.checked }))}
                  aria-label={t('เลือก {name}', { name: l.product.name })}
                  className="h-5 w-5 cursor-pointer accent-[var(--color-brand)]"
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">{l.product.name}</div>
                  <div className="truncate text-xs text-ink-faint">
                    {b.kind === 'pr' && <>{l.supplierName ?? t('ยังไม่มีผู้ขาย')} · </>}
                    {l.basis === 'usage' && l.avgDaily ? t('ใช้วันละ {n}', { n: fmtQty(l.avgDaily) }) : t('ตามขั้นต่ำ')}
                    {/* On a phone the on-hand column is not there; say it here. */}
                    <span className="md:hidden"> · {t('มี {n} {unit}', { n: fmtQty(l.onHand), unit: l.product.unitType })}</span>
                  </div>
                </div>
                <div className="num hidden text-right text-xs text-ink-soft md:block">
                  {t('มี {n} {unit}', { n: fmtQty(l.onHand), unit: l.product.unitType })}
                </div>
                <div className="col-span-2 col-start-2 flex items-center gap-2 md:col-span-1 md:col-start-auto">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
                    value={qty[k] ?? String(l.qty)}
                    onChange={(e) => setQty((c) => ({ ...c, [k]: e.target.value }))}
                    aria-label={t('จำนวน: {name}', { name: l.product.name })}
                    className="num min-h-10 !w-24 text-right"
                  />
                  <span className="text-xs text-ink-soft">{l.product.unitType}</span>
                </div>
                <div className="col-span-3 flex flex-wrap gap-1 md:col-span-1 md:justify-end">
                  {l.inProgress && (
                    <StatusChip tone="slate" size="sm" icon="clock">
                      {t('มีใบค้าง {docNo}', { docNo: l.inProgress.docNo })}
                    </StatusChip>
                  )}
                  {l.limitedTo !== undefined && (
                    <StatusChip tone="amber" size="sm">
                      {l.limitedTo > 0 ? t('คลังมีแค่ {n}', { n: fmtQty(l.limitedTo) }) : t('คลังไม่มีของ')}
                    </StatusChip>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {b.lines.length > FOLD && (
          <button
            type="button"
            onClick={() => setOpen((c) => ({ ...c, [b.id]: !c[b.id] }))}
            className="w-full cursor-pointer border-t border-line py-2 text-sm font-medium text-brand hover:bg-sunken"
          >
            {open[b.id] ? t('ย่อ') : t('ดูทั้งหมด ({n})', { n: b.lines.length })}
          </button>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2.5">
          <span className="text-xs text-ink-faint">{b.hint}</span>
          <Button onClick={b.run} disabled={!!busy || n === 0} className="w-full sm:w-auto">
            <Icon name="plus" size={16} />
            {busy === b.busyKey ? t('กำลังสร้าง...') : b.action}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <SectionCard
      icon="lightbulb"
      title={t('ข้อเสนอแนะประจำวัน')}
      count={suggestions ? t('({n} รายการ)', { n: blocks.reduce((n, b) => n + b.lines.length, 0) }) : undefined}
      actions={
        // LINE's green, not LINE's logo (owner, 4 Oct 2026): LINE allows its icon on a share
        // button only as its own unaltered file, and forbids look-alikes — the colour says
        // where this goes without either.
        <Button
          onClick={() => void shareDigest()}
          disabled={!suggestions || !!busy}
          size="sm"
          className="!border-transparent !bg-[#06C755] !text-white hover:!bg-[#05b14b]"
        >
          <Icon name="share" size={15} />
          {busy === 'digest' ? t('กำลังเปิด LINE...') : t('แชร์ LINE')}
        </Button>
      }
    >
      {!suggestions ? (
        <p className="py-4 text-center text-sm text-ink-faint">{t('กำลังคำนวณ...')}</p>
      ) : blocks.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-faint">{t('วันนี้ยังไม่มีอะไรต้องสั่งหรือโอน')}</p>
      ) : (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {blocks.map((b) => {
            const no = siteNumber(b.site)
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setShowing(b.id)}
                className="group flex w-24 cursor-pointer flex-col items-center gap-1.5 text-center"
                aria-label={b.title}
              >
                <span className="relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-brand bg-surface text-brand transition-colors group-hover:bg-brand-soft">
                  <Icon name={b.site.type === 'warehouse' ? 'building' : 'store'} size={24} />
                  <span className="num absolute -right-1.5 -top-1.5 min-w-6 rounded-full bg-brand px-1.5 text-xs font-bold leading-5 text-white">
                    {b.lines.length}
                  </span>
                </span>
                <span className="text-sm font-semibold leading-tight text-ink">
                  {shortSiteName(b.site.name)}
                  {no !== null && ` ${no}`}
                </span>
                <span className="text-xs leading-tight text-ink-soft">{b.kind === 'pr' ? t('ขอสั่งซื้อ') : t('ขอโอน')}</span>
              </button>
            )
          })}
        </div>
      )}
      {(() => {
        const b = blocks.find((x) => x.id === showing)
        return b ? (
          <Modal open wide onClose={() => setShowing(null)} title={b.title}>
            <p className="mb-3 text-xs text-ink-soft">
              {t('คำนวณจากยอดคงเหลือ ขั้นต่ำ และอัตราการใช้ — ตัวเลขเดียวกับคำแนะนำในปฏิทินคลัง ยังไม่มีอะไรถูกบันทึกจนกว่าจะกดสร้างร่าง')}
            </p>
            {blockBody(b)}
          </Modal>
        ) : null
      })()}
    </SectionCard>
  )
}
