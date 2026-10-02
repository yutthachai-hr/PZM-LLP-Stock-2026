import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { useData } from '../data/DataContext'
import { Spinner } from '../components/ui'
import { FramePage, PageHero, StatRow, StatTile, type Trend } from '../components/frame'
import {
  BranchOverviewCard,
  LowStockCard,
  QuickMenuCard,
  RecentActivityCard,
  WeeklyMovementCard,
} from '../components/dashboard/DeskCards'
import { useDashboardFigures } from '../components/dashboard/useDashboardFigures'
import { DailySuggestions } from '../components/dashboard/DailySuggestions'
import { isManager } from '../lib/purchaseRequestStatus'
import { fmtMoney, formatThaiDate } from '../lib/format'
import { change } from '../lib/stats/periodCompare'
import { useT } from '../i18n/I18nContext'
import { useViewport } from '../lib/viewport'
import { PhoneHome } from './PhoneHome'

/**
 * The desk dashboard, as the owner's mock-up 01 draws it (spec §2.1): a greeting, five
 * figures with what they were yesterday or a month ago, the week's movement, what is
 * running low, each site at a glance, what just happened, and the jobs people start
 * from here. A phone gets its own first screen (PhoneHome).
 *
 * The full stock table and the per-site switch that used to live here are on สินค้าคงคลัง,
 * which is the screen for reading every balance.
 */
export function DashboardPage() {
  const t = useT()
  const phone = useViewport() === 'phone'
  const { loading } = useData()
  if (loading) return <Spinner label={t('กำลังโหลดภาพรวม...')} />
  if (phone) return <PhoneHome />
  return <DeskDashboard />
}

function DeskDashboard() {
  const t = useT()
  const { user } = useAuth()
  const { brand } = useBrand()
  const { movements } = useData()
  // Re-read on the hour so a screen left open overnight rolls over to the new day.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [])
  const f = useDashboardFigures(now)

  const items = t('รายการ')
  const trend = (cur: number, before: number, suffix: string): Trend | undefined => {
    const c = change(cur, before, { unit: items })
    return c.flat ? undefined : { text: c.text, up: c.up, suffix }
  }
  const valueTrend = f.valueBefore !== null && f.valueBefore > 0 ? change(f.value, f.valueBefore) : null

  return (
    <FramePage>
      <PageHero
        icon="sparkles"
        title={t('สวัสดี คุณ {name}', { name: user?.name ?? '' })}
        subtitle={t('ภาพรวมสินค้าคงคลังของ {brand} ประจำวันที่ {date}', {
          brand: brand ? brandDef(brand).name : '',
          date: formatThaiDate(now),
        })}
      />

      <StatRow columns={5}>
        <StatTile
          icon="receive"
          tone="green"
          label={t('รับสินค้าเข้าวันนี้')}
          value={f.receivedToday}
          unit={items}
          trend={trend(f.receivedToday, f.receivedYesterday, t('จากเมื่อวาน'))}
          hint={t('เมื่อวาน {n} ใบ', { n: f.receivedYesterday })}
          to="/movements"
        />
        <StatTile
          icon="note"
          tone="red"
          label={t('รออนุมัติใบขอสั่งซื้อ')}
          value={f.pendingRequests ?? '–'}
          unit={items}
          hint={t('ใบขอใน 30 วันล่าสุด')}
          to="/requests?filter=pendingApproval"
        />
        <StatTile
          icon="warning"
          tone="amber"
          label={t('สินค้าคงเหลือน้อย')}
          value={f.low.length}
          unit={items}
          hint={f.outCount > 0 ? t('หมดแล้ว {n} รายการ', { n: f.outCount }) : t('ยังไม่มีรายการที่หมด')}
          to="/products"
        />
        <StatTile
          icon="swap"
          tone="blue"
          label={t('โอนสาขาวันนี้')}
          value={f.transfersToday}
          unit={items}
          trend={trend(f.transfersToday, f.transfersYesterday, t('จากเมื่อวาน'))}
          hint={t('เมื่อวาน {n} ใบ', { n: f.transfersYesterday })}
          to="/issue"
        />
        <StatTile
          icon="box"
          tone="purple"
          label={t('มูลค่าสินค้าคงคลัง')}
          value={`฿ ${fmtMoney(f.value)}`} /* ฿ is a currency symbol — i18n-key */
          trend={valueTrend && !valueTrend.flat ? { text: valueTrend.text, up: valueTrend.up, suffix: t('จาก 7 วันก่อน') } : undefined}
          hint={t('อิงต้นทุนที่กรอก')}
          to="/reports"
        />
      </StatRow>

      {/* Phase 1 of the automation plan: every reorder suggestion of the day, draftable in
          one press. For the people who decide what to buy and send. */}
      {isManager(user?.role) && <DailySuggestions />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] xl:gap-5">
        <WeeklyMovementCard weekly={f.weekly} />
        <LowStockCard low={f.low} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.75fr)] xl:gap-5">
        <div className="md:col-span-2 xl:col-span-1">
          <BranchOverviewCard branches={f.branches} />
        </div>
        <RecentActivityCard movements={movements} requests={f.requests} orders={f.orders} />
        <QuickMenuCard />
      </div>
    </FramePage>
  )
}
