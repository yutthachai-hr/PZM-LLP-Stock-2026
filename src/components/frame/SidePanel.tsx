import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n/I18nContext'
import { Icon, type IconName } from '../Icon'
import { SectionCard, SeeAll } from './SectionCard'
import { focusRing, toneIcon, toneText, type Tone } from './tones'

/**
 * A page with a column of summary cards beside it (owner's mock-ups: ~360px on the right).
 *
 * The three screen sizes each place that column differently (spec §1):
 * - desktop ≥1280: beside the page, 360px;
 * - tablet: under the page, its cards two to a row — moved, not hidden;
 * - phone: under the page as one section that starts folded, so the form or list the
 *   person came for is the first thing on the screen.
 */
export function WithSidePanel({
  children,
  side,
  sideLabel,
}: {
  children: ReactNode
  side: ReactNode
  // The phone's fold heading — "สรุปและรายการล่าสุด".
  sideLabel?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-5">
      <div className="min-w-0 space-y-4 xl:space-y-5">{children}</div>
      <aside className="min-w-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`flex min-h-12 w-full cursor-pointer items-center justify-between rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink md:hidden ${focusRing}`}
        >
          {sideLabel ?? t('สรุปและรายการล่าสุด')}
          <Icon name="chevronDown" size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <div className={`${open ? 'mt-3 grid' : 'hidden'} gap-4 md:mt-0 md:grid md:grid-cols-2 xl:grid-cols-1 xl:gap-5`}>
          {side}
        </div>
      </aside>
    </div>
  )
}

// "สรุป…วันนี้": rows of icon + label + figure.
export interface SummaryRow {
  key: string
  icon: IconName
  tone: Tone
  label: string
  value: ReactNode
  // Colour the figure too (a red "ยกเลิก 1").
  strong?: boolean
}

export function SummaryList({ title, icon = 'chart', rows }: { title: string; icon?: IconName; rows: SummaryRow[] }) {
  return (
    <SectionCard icon={icon} title={title}>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3 py-2.5">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toneIcon[r.tone]}`}>
              <Icon name={r.icon} size={17} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{r.label}</span>
            <span className={`num text-base font-bold ${r.strong ? toneText[r.tone] : 'text-ink'}`}>{r.value}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

// "…ล่าสุด": five entries, each with its state at the right, and a way to the full list.
export interface RecentItem {
  key: string
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
  to?: string
}

export function RecentList({
  title,
  icon = 'history',
  items,
  seeAllTo,
  empty,
}: {
  title: string
  icon?: IconName
  items: RecentItem[]
  seeAllTo?: string
  empty?: string
}) {
  const t = useT()
  return (
    <SectionCard icon={icon} title={title} actions={seeAllTo && <SeeAll to={seeAllTo} />}>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-faint">{empty ?? t('ยังไม่มีรายการ')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((it) => {
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{it.title}</span>
                  {it.sub && <span className="block truncate text-xs text-ink-faint">{it.sub}</span>}
                </span>
                {it.right && <span className="shrink-0">{it.right}</span>}
              </>
            )
            return (
              <li key={it.key}>
                {it.to ? (
                  <Link to={it.to} className={`-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-sunken ${focusRing}`}>
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 py-2.5">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </SectionCard>
  )
}

// "คำแนะนำ" / "เคล็ดลับ": a soft card with a lightbulb and a few lines of advice.
export function TipCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-tile-blue/15 bg-tile-blue-soft/60 p-4 md:p-5">
      <div className="mb-2 flex items-center gap-2 font-bold text-ink">
        <Icon name="lightbulb" size={18} className="text-tile-amber" />
        {title}
      </div>
      <div className="space-y-1.5 text-sm leading-relaxed text-ink-soft">{children}</div>
    </div>
  )
}
