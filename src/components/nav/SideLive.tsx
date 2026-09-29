import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../../data/DataContext'
import { orderCache } from '../../data/orderCache'
import { useI18n, useT } from '../../i18n/I18nContext'
import { shortages } from '../../lib/inventoryRules/lowStock'
import { bkkDayEnd, bkkDayStart, DAY_MS } from '../../lib/inventoryRules/time'
import { dueToday, recentActivity, sinceLabel, type LiveKind } from '../../lib/sidebarLive'
import { fetchWeather, WEATHER_TTL_MS, type Sky, type Weather } from '../../services/weather'
import type { PurchaseOrder } from '../../types'
import { Icon, type IconName } from '../Icon'

/**
 * The panels under the menu (owner, 27 Sep 2026): the latest activity, today at a glance,
 * and the time with Bangkok's weather — tinted darkest to lightest, their icons moving a
 * little now and then so the system reads as alive. Everything shown is what the app
 * already holds (the movement listener, the order cache the dashboard filled, the stock
 * balances), so it costs no read and no write; the weather comes from Open-Meteo, not the
 * database. Styles and motion are the lv- rules at the end of index.css (pure CSS, off
 * under reduced motion; the panels drop out bottom-up on short screens).
 */
export function SideLive({ todayCount }: { todayCount: number }) {
  const t = useT()
  const { lang } = useI18n()
  const { movements, products, locations, qtyAt, minFor, tracksProduct } = useData()
  const now = useMinute()
  const orders = usePeekedOrders(now)
  const weather = useWeather()

  const feed = useMemo(() => recentActivity(movements, orders, now, 3), [movements, orders, now])
  const low = useMemo(
    () => shortages({ products, locations, qtyAt, minFor, tracksProduct }).length,
    [products, locations, qtyAt, minFor, tracksProduct],
  )
  const due = useMemo(() => dueToday(orders, now), [orders, now])
  const fresh = useFreshKeys(feed.map((i) => i.key))

  const time = new Date(now)
  const hh = String(time.getHours()).padStart(2, '0')
  const mm = String(time.getMinutes()).padStart(2, '0')
  const date = new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(time)

  const chips: { to: string; icon: IconName; motion: string; n: number; label: string; alert?: boolean }[] = [
    { to: '/receive', icon: 'truck', motion: 'lv-i-truck', n: due, label: t('ของเข้า') },
    { to: '/calendar', icon: 'calendar', motion: 'lv-i-calendar', n: todayCount, label: t('งาน') },
    { to: '/products', icon: 'warning', motion: 'lv-i-warning', n: low, label: t('ใกล้หมด'), alert: low > 0 },
  ]

  return (
    <div className="lv-stack">
      <section className="lv-panel lv-b" aria-label={t('ความเคลื่อนไหวล่าสุด')}>
        <div className="lv-title">
          <span className="lv-live" role="img" aria-label={t('อัปเดตสด')} />
          {t('ความเคลื่อนไหวล่าสุด')}
        </div>
        {feed.length === 0 ? (
          <div className="lv-empty">{t('ยังไม่มีความเคลื่อนไหว')}</div>
        ) : (
          <div className="lv-feed">
            {feed.map((i) => {
              const since = sinceLabel(i.at, now)
              return (
                <Link key={i.key} to={i.link} className={`lv-row ${fresh.has(i.key) ? 'is-new' : ''}`} title={`${i.docNo} · ${i.subject}`}>
                  <span className={`lv-ico ${KIND[i.kind].motion}`} aria-hidden="true">
                    <Icon name={KIND[i.kind].icon} size={14} />
                  </span>
                  <span className="lv-text">
                    <b>{i.who}</b> {t(KIND[i.kind].verb)} <span className="lv-doc">{i.docNo}</span>
                  </span>
                  <span className="lv-time">{t(since.key, since.n === undefined ? undefined : { n: since.n })}</span>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <section className="lv-panel lv-c" aria-label={t('วันนี้')}>
        <div className="lv-title">{t('วันนี้')}</div>
        <div className="lv-chips">
          {chips.map((c) => (
            <Link key={c.to} to={c.to} className="lv-chip" data-zero={c.n === 0 || undefined} data-alert={c.alert || undefined}>
              <span className={`lv-ico ${c.motion}`} aria-hidden="true">
                <Icon name={c.icon} size={15} />
              </span>
              <span className="lv-num">{c.n}</span>
              <span className="lv-lbl">{c.label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="lv-panel lv-d" aria-label={t('เวลาและอากาศ')}>
        <div>
          <div className="lv-clock">
            {hh}
            <span className="lv-colon">:</span>
            {mm}
          </div>
          <div className="lv-date">{date}</div>
        </div>
        {weather && (
          <div className="lv-wx">
            <SkyIcon sky={weather.sky} isDay={weather.isDay} />
            <span className="lv-temp">{weather.temp}°</span>
            <span className="lv-wx-lbl">
              {t('กรุงเทพ')} · {t(SKY_LABEL[weather.sky])}
            </span>
          </div>
        )}
      </section>
    </div>
  )
}

const KIND: Record<LiveKind, { icon: IconName; motion: string; verb: string }> = {
  receive: { icon: 'receive', motion: 'lv-i-receive', verb: 'รับของ' }, // i18n-key
  issue: { icon: 'send', motion: 'lv-i-send', verb: 'เบิก' }, // i18n-key
  transfer: { icon: 'swap', motion: 'lv-i-swap', verb: 'โอน' }, // i18n-key
  adjust: { icon: 'adjust', motion: 'lv-i-adjust', verb: 'ปรับสต๊อก' }, // i18n-key
  consume: { icon: 'package', motion: 'lv-i-check', verb: 'ตัดใช้' }, // i18n-key
  order: { icon: 'cart', motion: 'lv-i-cart', verb: 'สั่งซื้อ' }, // i18n-key
}

const SKY_LABEL: Record<Sky, string> = {
  clear: 'แจ่มใส', // i18n-key
  partly: 'มีเมฆบางส่วน', // i18n-key
  cloudy: 'เมฆมาก', // i18n-key
  fog: 'หมอก', // i18n-key
  rain: 'ฝนตก', // i18n-key
  storm: 'พายุฝนฟ้าคะนอง', // i18n-key
}

/** Keys that were not in the list before — the rows to announce. None on the first draw. */
function useFreshKeys(keys: string[]): Set<string> {
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const sig = keys.join('|')
  useEffect(() => {
    const list = sig ? sig.split('|') : []
    if (seen.current === null) {
      seen.current = new Set(list)
      return
    }
    const added = list.filter((k) => !seen.current!.has(k))
    for (const k of list) seen.current.add(k)
    if (added.length) setFresh(new Set(added))
  }, [sig])
  return fresh
}

/** The time, re-read at the turn of every minute — one timer, no reads. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(Date.now())
      id = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50)
    }
    id = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50)
    return () => clearTimeout(id)
  }, [])
  return now
}

/**
 * The orders the dashboard already fetched (the same week-back window), read from the
 * cache without ever asking the database: before the dashboard has been opened there are
 * none, and the feed shows stock documents only.
 */
function usePeekedOrders(now: number): PurchaseOrder[] {
  const range = () => orderCache.peekRange(bkkDayStart(now) - 7 * DAY_MS, bkkDayEnd(now)) ?? []
  const [orders, setOrders] = useState<PurchaseOrder[]>(range)
  useEffect(() => {
    const refresh = () => setOrders(orderCache.peekRange(bkkDayStart(now) - 7 * DAY_MS, bkkDayEnd(now)) ?? [])
    refresh()
    return orderCache.subscribe(refresh)
  }, [now])
  return orders
}

function useWeather(): Weather | null {
  const [w, setW] = useState<Weather | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      void fetchWeather(Date.now()).then((x) => {
        if (alive && x) setW(x)
      })
    load()
    const id = setInterval(load, WEATHER_TTL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return w
}

/** Weather drawn in parts, so rays, drops and the bolt can move on their own. */
function SkyIcon({ sky, isDay }: { sky: Sky; isDay: boolean }) {
  const cloud = 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'
  const raised = 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242'
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {sky === 'clear' &&
        (isDay ? (
          <>
            <g className="lv-rays">
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </g>
            <circle className="lv-core" cx="12" cy="12" r="4" />
          </>
        ) : (
          <path className="lv-cloud" d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        ))}
      {sky === 'partly' && (
        <>
          <g className="lv-rays">
            <path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41" />
          </g>
          <path className="lv-core" d="M15.947 12.65a4 4 0 0 0-5.925-4.128" />
          <path className="lv-cloud" d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
        </>
      )}
      {sky === 'cloudy' && <path className="lv-cloud" d={cloud} />}
      {sky === 'fog' && (
        <>
          <path className="lv-cloud" d={raised} />
          <path d="M16 17H7M17 21H9" />
        </>
      )}
      {sky === 'rain' && (
        <>
          <path className="lv-cloud" d={raised} />
          <g>
            <path className="lv-drop" d="M8 14v4" />
            <path className="lv-drop" d="M12 16v4" />
            <path className="lv-drop" d="M16 14v4" />
          </g>
        </>
      )}
      {sky === 'storm' && (
        <>
          <path className="lv-cloud" d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973" />
          <path className="lv-bolt" d="M13 12l-3 5h4l-3 5" />
        </>
      )}
    </svg>
  )
}
