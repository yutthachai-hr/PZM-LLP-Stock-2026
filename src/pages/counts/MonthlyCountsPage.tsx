import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { FramePage, PageHero, SectionCard } from '../../components/frame'
import { Icon } from '../../components/Icon'
import { SiteSelect } from '../../components/SiteChip'
import { useToast } from '../../components/Toast'
import { Button, Field, Input } from '../../components/ui'
import { useData } from '../../data/DataContext'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { previousMonth } from '../../lib/monthlyCount'
import { listMonthlyCounts, openMonthlyCount } from '../../services/monthlyCounts'
import { TRANSIT_LOCATION_ID, type MonthlyCount } from '../../types'
import { MonthLabel, StatusBadge } from './labels'

/**
 * นับสต๊อกประจำเดือน (owner, 29 Sep 2026): one sheet per location per month. Open it,
 * count, check the differences, and a manager confirms — nothing moves before that.
 */
export function MonthlyCountsPage() {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { locations, locationById } = useData()
  const sites = useMemo(() => locations.filter((l) => l.active !== false && l.id !== TRANSIT_LOCATION_ID), [locations])
  const [locationId, setLocationId] = useState('')
  const [month, setMonth] = useState(() => previousMonth(Date.now()))
  const [sheets, setSheets] = useState<MonthlyCount[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [blind, setBlind] = useState(false)
  const isManager = user?.role === 'admin' || user?.role === 'manager'

  useEffect(() => {
    if (!locationId && sites[0]) setLocationId(sites[0].id)
  }, [sites, locationId])

  useEffect(() => {
    let alive = true
    listMonthlyCounts()
      .then((s) => alive && setSheets(s))
      .catch((e) => {
        if (alive) setSheets([])
        toast.error(errText(e, t))
      })
    return () => {
      alive = false
    }
  }, [toast, t])

  async function open() {
    if (!user) return
    setBusy(true)
    try {
      const id = await openMonthlyCount({ locationId, month, actor: { id: user.id, name: user.name }, blind: isManager && blind })
      navigate(`/counts/${encodeURIComponent(id)}`)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FramePage>
      <PageHero
        icon="clipboardList"
        title={t('นับสต๊อกประจำเดือน')}
        subtitle={t('นับก่อน ตรวจผลต่าง แล้วหัวหน้ายืนยัน — ระหว่างนับยังไม่ปรับสต๊อก')}
      />

      <SectionCard icon="plus" title={t('เปิดใบนับ')}>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
          <Field label={t('คลัง/สาขา')} required>
            <SiteSelect value={locationId} onChange={setLocationId} locations={sites} />
          </Field>
          <Field label={t('เดือนที่นับ')} required>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <Button onClick={() => void open()} disabled={busy || !locationId || !month}>
            <Icon name="clipboardList" size={16} />
            {t('เปิดใบนับ')}
          </Button>
        </div>
        {isManager && (
          <label className="mt-3 flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" className="mt-1" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
            <span>
              {t('นับแบบไม่เห็นยอด (blind count)')}
              <span className="block text-xs text-ink-faint">{t('พนักงานที่นับจะไม่เห็นยอดในระบบและผลต่าง หัวหน้ายังเห็นตอนตรวจ — ใช้กับใบที่ยังไม่เคยเปิด')}</span>
            </span>
          </label>
        )}
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          {t('นับเช้าวันที่ 1 ก่อนรับและเบิกของ แล้วเลือกเดือนที่เพิ่งจบ — ยอดที่นับได้คือยอดปิดของเดือนนั้นและยอดยกมาของเดือนใหม่')}
        </p>
      </SectionCard>

      <SectionCard icon="history" title={t('ใบนับทั้งหมด')} count={sheets ? sheets.length : undefined} flush>
        {sheets === null ? (
          <p className="px-5 py-6 text-sm text-ink-faint">{t('กำลังโหลด...')}</p>
        ) : sheets.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-faint">{t('ยังไม่มีใบนับ')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {sheets.map((s) => (
              <li key={s.id}>
                <Link to={`/counts/${encodeURIComponent(s.id)}`} className="row-hover flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">
                      <MonthLabel month={s.month} /> · {locationById(s.locationId)?.name ?? s.locationId}
                    </span>
                    <span className="block text-xs text-ink-faint">
                      {t('นับแล้ว {n} รายการ', { n: Object.keys(s.lines ?? {}).length })}
                      {s.confirmedByName ? ` · ${t('ยืนยันโดย {name}', { name: s.confirmedByName })}` : ''}
                    </span>
                  </span>
                  <StatusBadge status={s.status} />
                  <Icon name="chevronRight" size={16} className="text-ink-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </FramePage>
  )
}
