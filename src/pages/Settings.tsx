import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { UnitMigrationSection } from './settings/UnitMigrationSection'
import { RebaseUnitSection } from './settings/RebaseUnitSection'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { LangToggle } from '../i18n/LangToggle'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { BackupSection } from '../components/BackupSection'
import { AutomationStatus } from './settings/AutomationStatus'
import { ReadUsageSection } from './settings/ReadUsageSection'
import { NotificationPrefsSection } from './settings/NotificationPrefsSection'
import { SchedulesSection } from './settings/SchedulesSection'
import { ThresholdsSection } from './settings/ThresholdsSection'
import { Icon, type IconName } from '../components/Icon'
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  EmptyState,
  rowAction,
  SearchInput,
  SectionHeader,
  Select,
} from '../components/ui'
import { PageHero } from '../components/frame'
import { looseMatch } from '../lib/search'
import { createLocation, updateLocation, deleteLocation } from '../services/locations'
import {
  createUser,
  updateUserProfile,
  deleteUser,
  restoreUser,
  listRevoked,
  type RevokedUser,
} from '../services/users'
import { recomputeLevels, findLevelDrift, type LevelDrift } from '../services/stock'
import { seedInitialData } from '../services/seed'
import { DEFAULT_UNITS, saveEntryUnits, useEntryUnits } from '../services/entryUnits'
import {
  clearFirebaseConfig,
  getFirebaseConfig,
  isDemoMode,
  parseConfigInput,
  saveFirebaseConfig,
} from '../firebase/config'
import type { AppUser, LocationType, StockLocation, Role } from '../types'
import { CompanyProfileSection } from './settings/CompanyProfileSection'
import { LogisticsSection } from './settings/LogisticsSection'
import { DataTable } from '../components/DataTable'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'

/**
 * Settings as a menu, then one topic at a time.
 *
 * It used to be every section stacked on one page — thirteen cards for an admin, each with
 * its own buttons, so finding "users" meant scrolling past backups and unit migrations. The
 * owner's mock-up (21 Sep 2026) is the phone settings pattern people already know: grouped
 * rows with an icon, a name and a chevron, and each row opens its topic on its own.
 *
 * The topic lives in the URL (/settings/users), so the back button works, a link can go
 * straight to one, and nothing is read for a topic nobody opened — each section loads its
 * own data when it mounts, and Firestore reads are the budget this app lives within.
 *
 * On a desktop the menu stays on the left and the topic opens beside it.
 */
type SectionKey =
  | 'notifications'
  | 'cloud'
  | 'locations'
  | 'units'
  | 'thresholds'
  | 'schedules'
  | 'readUsage'
  | 'users'
  | 'automation'
  | 'backup'
  | 'maintenance'
  | 'unitMigration'
  | 'rebaseUnit'
  | 'company'
  | 'logistics'

interface MenuItem {
  key: SectionKey | 'import'
  /** A page of its own rather than a topic here — Excel import (moved from the menu, 25 Sep 2026). */
  to?: string
  label: string
  hint: string
  icon: IconName
  /** Whether this person may open it; filtered out of the menu when false. */
  show?: boolean
}

interface MenuGroup {
  title: string
  items: MenuItem[]
}

function useIsDesktop(): boolean {
  const query = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

export function SettingsPage() {
  const t = useT()
  const { user, mode, logout } = useAuth()
  const { reset } = useBrand()
  const navigate = useNavigate()
  const { section } = useParams<{ section?: string }>()
  const desktop = useIsDesktop()
  const [query, setQuery] = useState('')
  const isAdmin = user?.role === 'admin'
  const isManager = isAdmin || user?.role === 'manager'

  // Only what this person may open. A row that leads to "you do not have permission" is a
  // row that should not be there.
  const groups: MenuGroup[] = useMemo(() => {
    const all: MenuGroup[] = [
      {
        title: t('บัญชีของฉัน'),
        items: [
          { key: 'notifications', label: t('การแจ้งเตือนของฉัน'), hint: t('เลือกสิ่งที่อยากเห็นในกระดิ่ง'), icon: 'bell', show: true },
          { key: 'cloud', label: t('การเชื่อมต่อ Cloud'), hint: t('สถานะการเชื่อมต่อฐานข้อมูล'), icon: 'cloud', show: !isDemoMode() },
        ],
      },
      {
        title: t('คลังและสินค้า'),
        items: [
          { key: 'locations', label: t('คลัง / สาขา'), hint: t('เพิ่ม แก้ชื่อ หรือปิดใช้คลังและสาขา'), icon: 'building', show: isAdmin },
          { key: 'units', label: t('หน่วยที่เลือกได้ตอนกรอก'), hint: t('Lot, Pack, Carton ที่ให้เลือกตอนคีย์จำนวน'), icon: 'package', show: isAdmin },
          { key: 'thresholds', label: t('เกณฑ์แจ้งเตือนคลัง'), hint: t('เมื่อไรถือว่าใกล้หมดหรือค้างนาน'), icon: 'warning', show: isAdmin },
          { key: 'logistics', label: t('ระบบส่งสินค้า'), hint: t('เปิดใช้คลังระหว่างขนส่งของแต่ละบริษัท'), icon: 'truck', show: isAdmin },
          { key: 'schedules', label: t('ตารางนับสต๊อก'), hint: t('รอบนับสต๊อกที่ขึ้นในปฏิทิน'), icon: 'calendar', show: isAdmin },
        ],
      },
      {
        title: t('ผู้ใช้และระบบ'),
        items: [
          { key: 'company', label: t('ข้อมูลบริษัท'), hint: t('โลโก้และตัวย่อเลขเอกสารที่ใช้ในประกาศบริษัท'), icon: 'building', show: isAdmin },
          { key: 'users', label: t('ผู้ใช้งาน'), hint: t('เพิ่มผู้ใช้ กำหนดสิทธิ์ ปิดการเข้าใช้'), icon: 'users', show: isAdmin },
          { key: 'automation', label: t('งานอัตโนมัติ'), hint: t('งานที่ระบบทำเองตามเวลา'), icon: 'clock', show: isManager },
          { key: 'readUsage', label: t('การอ่านข้อมูล (โควตา)'), hint: t('แอปอ่านไปกี่รายการแล้ว และคอลเลกชันไหนมากที่สุด'), icon: 'cloud', show: isAdmin },
        ],
      },
      {
        title: t('ข้อมูล'),
        items: [
          { key: 'import', to: '/import', label: t('นำเข้า Excel'), hint: t('นำเข้าสต๊อกและรายการสินค้าจากไฟล์ Excel'), icon: 'upload', show: isAdmin },
          { key: 'backup', label: t('สำรอง / กู้คืนข้อมูล'), hint: t('ดาวน์โหลดไฟล์สำรอง หรือกู้คืนจากไฟล์'), icon: 'download', show: isAdmin },
          { key: 'maintenance', label: t('ดูแลข้อมูล'), hint: t('ตรวจยอดคงเหลือให้ตรงกับประวัติ'), icon: 'refresh', show: isAdmin },
          { key: 'unitMigration', label: t('แปลงยอดแยกหน่วยเป็นหน่วยหลัก'), hint: t('รวมยอดที่เคยเก็บแยกหน่วย'), icon: 'adjust', show: isAdmin },
          { key: 'rebaseUnit', label: t('เปลี่ยนหน่วยหลักพร้อมคำนวณ'), hint: t('เปลี่ยนหน่วยหลักของสินค้าและคำนวณยอดใหม่'), icon: 'swap', show: isAdmin },
        ],
      },
    ]
    return all
      .map((g) => ({ title: g.title, items: g.items.filter((i) => i.show !== false) }))
      .filter((g) => g.items.length > 0)
  }, [t, isAdmin, isManager])

  const keys = groups.flatMap((g) => g.items.filter((i) => !i.to).map((i) => i.key))
  const go = (it: MenuItem) => navigate(it.to ?? `/settings/${it.key}`)
  const chosen = keys.includes(section as SectionKey) ? (section as SectionKey) : null
  const open: SectionKey | null = chosen
  const openItem = groups.flatMap((g) => g.items).find((i) => i.key === open)

  function renderSection(key: SectionKey) {
    const actor = user ? { id: user.id, name: user.name } : null
    switch (key) {
      case 'notifications':
        return <NotificationPrefsSection />
      case 'cloud':
        return <CloudSection mode={mode} />
      case 'locations':
        return <LocationsSection />
      case 'units':
        return <UnitsSection />
      case 'thresholds':
        return <ThresholdsSection />
      case 'schedules':
        return <SchedulesSection />
      case 'users':
        return user ? <UsersSection currentUserId={user.id} /> : null
      case 'automation':
        return <AutomationStatus />
      case 'readUsage':
        return <ReadUsageSection />
      case 'backup':
        return <BackupSection />
      case 'maintenance':
        return actor && <MaintenanceSection actor={actor} />
      case 'unitMigration':
        return actor && <UnitMigrationSection actor={actor} />
      case 'rebaseUnit':
        return actor && <RebaseUnitSection actor={actor} />
      case 'company':
        return <CompanyProfileSection />
      case 'logistics':
        return <LogisticsSection />
    }
  }

  // The phone's menu — the owner's mock-up. A desktop gets its own layout further down.
  const menu = (
    <nav aria-label={t('ตั้งค่า')} className="space-y-5">
      {groups.map((g) => (
        <section key={g.title}>
          <h2 className="mb-2 px-1 text-sm font-semibold text-ink">{g.title}</h2>
          <ul className="overflow-hidden rounded-2xl bg-sunken ring-1 ring-inset ring-line/70">
            {g.items.map((it) => {
              return (
                <li key={it.key} className="border-b border-line/70 last:border-0">
                  <button onClick={() => go(it)} className={actionRow}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-ink-soft">
                      <Icon name={it.icon} size={19} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink">{it.label}</span>
                      <span className="block truncate text-xs text-ink-faint">{it.hint}</span>
                    </span>
                    <Icon name="chevronRight" size={18} className="text-ink-faint" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold text-ink">{t('ทั่วไป')}</h2>
        <ul className="overflow-hidden rounded-2xl bg-sunken ring-1 ring-inset ring-line/70">
          <li className="flex min-h-14 items-center gap-3 border-b border-line/70 px-4 py-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-ink-soft">
              <Icon name="globe" size={19} />
            </span>
            <span className="min-w-0 flex-1 text-[15px] font-semibold text-ink">{t('ภาษา')}</span>
            <LangToggle className="w-28" />
          </li>
          <li className="border-b border-line/70">
            <button onClick={reset} className={actionRow}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-ink-soft">
                <Icon name="swap" size={19} />
              </span>
              <span className="min-w-0 flex-1 text-[15px] font-semibold text-ink">{t('สลับแบรนด์')}</span>
            </button>
          </li>
          <li>
            <button onClick={() => void logout()} className={actionRow}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger">
                <Icon name="logout" size={19} />
              </span>
              <span className="min-w-0 flex-1 text-[15px] font-semibold text-danger">{t('ออกจากระบบ')}</span>
            </button>
          </li>
        </ul>
      </section>

      {!isAdmin && (
        <p className="px-1 text-xs leading-relaxed text-ink-faint">
          {t('การจัดการคลัง ผู้ใช้ และข้อมูล ต้องเป็นสิทธิ์ผู้ดูแลระบบ (Admin)')}
        </p>
      )}
    </nav>
  )

  // Phone, topic open: the topic alone, with the way back to the menu above it.
  if (!desktop && open && openItem) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <button
          onClick={() => navigate('/settings')}
          className="-ml-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg px-2 text-sm font-medium text-brand outline-none hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <Icon name="chevronLeft" size={20} />
          {t('ตั้งค่า')}
        </button>
        {renderSection(open)}
      </div>
    )
  }

  if (!desktop) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHero icon="settings" title={t('ตั้งค่า')} />
        {menu}
      </div>
    )
  }

  // ---- Desktop -------------------------------------------------------------------------

  // Nothing chosen: every topic as a tile, grouped, with a filter. A desktop has the room
  // to show the whole of settings at once, so the first screen answers "what is in here"
  // instead of guessing which topic someone came for.
  if (!open || !openItem) {
    const q = query.trim().toLowerCase()
    const shown = groups
      .map((g) => ({ ...g, items: g.items.filter((i) => !q || looseMatch([i.label, i.hint, g.title], q)) }))
      .filter((g) => g.items.length > 0)
    return (
      <div className="space-y-6">
        <PageHero
          icon="settings"
          title={t('ตั้งค่า')}
          subtitle={t('ตั้งค่าระบบ คลัง ผู้ใช้ และข้อมูล — เลือกหัวข้อที่ต้องการ')}
          actions={
            <SearchInput value={query} onChange={setQuery} placeholder={t('ค้นหาการตั้งค่า...')} className="w-80" />
          }
        />

        {shown.length === 0 && <EmptyState icon="search" title={t('ไม่พบการตั้งค่าที่ตรงกับคำค้น')} />}

        {shown.map((g) => (
          <section key={g.title}>
            <h2 className="mb-3 text-base font-semibold text-ink">{g.title}</h2>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {g.items.map((it) => (
                <button
                  key={it.key}
                  onClick={() => go(it)}
                  className="group flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-4 text-left outline-none transition-[border-color,box-shadow] duration-150 hover:border-brand/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <Icon name={it.icon} size={21} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{it.label}</span>
                    <span className="mt-0.5 block text-sm leading-snug text-ink-soft">{it.hint}</span>
                  </span>
                  <Icon
                    name="chevronRight"
                    size={18}
                    className="mt-1 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-brand"
                  />
                </button>
              ))}
            </div>
          </section>
        ))}

        {!q && (
          <section>
            <h2 className="mb-3 text-base font-semibold text-ink">{t('ทั่วไป')}</h2>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-soft">
                  <Icon name="globe" size={21} />
                </span>
                <span className="min-w-0 flex-1 font-semibold text-ink">{t('ภาษา')}</span>
                <LangToggle className="w-28" />
              </div>
              <button onClick={reset} className={tileAction}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-soft">
                  <Icon name="swap" size={21} />
                </span>
                <span className="min-w-0 flex-1 font-semibold text-ink">{t('สลับแบรนด์')}</span>
              </button>
              <button onClick={() => void logout()} className={`${tileAction} hover:border-danger/40`}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger">
                  <Icon name="logout" size={21} />
                </span>
                <span className="min-w-0 flex-1 font-semibold text-danger">{t('ออกจากระบบ')}</span>
              </button>
            </div>
            {!isAdmin && (
              <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                {t('การจัดการคลัง ผู้ใช้ และข้อมูล ต้องเป็นสิทธิ์ผู้ดูแลระบบ (Admin)')}
              </p>
            )}
          </section>
        )}
      </div>
    )
  }

  // A topic open: a compact menu down the left for moving between topics without going
  // back, and the topic beside it under a breadcrumb that says where you are.
  const openGroup = groups.find((g) => g.items.some((i) => i.key === open))
  return (
    <div className="grid grid-cols-[15rem_minmax(0,1fr)] items-start gap-8 xl:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="sticky top-20 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
        <button
          onClick={() => navigate('/settings')}
          className="mb-4 inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-ink-soft outline-none hover:bg-sunken hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <Icon name="chevronLeft" size={18} />
          {t('การตั้งค่าทั้งหมด')}
        </button>
        <nav aria-label={t('ตั้งค่า')} className="space-y-4">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="mb-1 px-3 text-xs font-semibold text-ink-faint">{g.title}</div>
              <ul className="space-y-0.5">
                {g.items.map((it) => {
                  const active = it.key === open
                  return (
                    <li key={it.key}>
                      <button
                        onClick={() => go(it)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand/40 ${
                          active
                            ? 'bg-brand-soft font-semibold text-brand ring-1 ring-inset ring-brand/20'
                            : 'text-ink-soft hover:bg-sunken hover:text-ink'
                        }`}
                      >
                        <Icon name={it.icon} size={17} />
                        <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="flex min-h-10 items-center">
          <div className="flex items-center gap-1.5 text-sm text-ink-faint">
            <button onClick={() => navigate('/settings')} className="cursor-pointer hover:text-brand hover:underline">
              {t('ตั้งค่า')}
            </button>
            <Icon name="chevronRight" size={14} />
            <span>{openGroup?.title}</span>
            <Icon name="chevronRight" size={14} />
            <span className="text-ink-soft">{openItem.label}</span>
          </div>
        </div>
        <div className="max-w-4xl">{renderSection(open)}</div>
      </div>
    </div>
  )
}

const tileAction =
  'flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface p-4 text-left outline-none transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand/40'

const actionRow =
  'flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-line/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40'


// ---------------- Entry units ----------------

/**
 * The words a quantity may be keyed in — Lot, Pack, Carton.
 *
 * Labels only: how many of the product's own unit one of these is belongs on each
 * product ("1 Carton = 500 EA"), because one supplier's carton is not another's. Since
 * 20 Sep 2026 the first person to key a unit on a product states that rate once.
 *
 * Saved as a single shared document, so adding a unit costs one write and reading the list
 * costs one read for the whole session.
 */
function UnitsSection() {
  const t = useT()
  const units = useEntryUnits()
  const toast = useToast()
  const confirm = useConfirm()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  async function commit(next: string[], okMessage: string) {
    setBusy(true)
    try {
      await saveEntryUnits(next)
      toast.success(okMessage)
      return true
    } catch (e) {
      toast.error(errText(e, t))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    const name = draft.trim()
    if (!name) return
    if (units.some((u) => u.toLowerCase() === name.toLowerCase())) {
      toast.error(t('มีหน่วยนี้อยู่แล้ว'))
      return
    }
    if (await commit([...units, name], t('เพิ่มแล้ว'))) setDraft('')
  }

  async function remove(name: string) {
    // Removing a unit changes nothing already recorded — movements hold numbers in the
    // product's own unit, never this label — so this only shortens the dropdown.
    const ok = await confirm({
      title: t('ลบหน่วย'),
      message: t('ลบ "{name}" ออกจากตัวเลือก? ประวัติที่บันทึกไปแล้วไม่เปลี่ยน', { name }),
      danger: true,
      confirmText: t('ลบ'),
    })
    if (!ok) return
    await commit(
      units.filter((u) => u !== name),
      t('ลบแล้ว'),
    )
  }

  return (
    <Card className="p-4">
      <SectionHeader
        icon="package"
        title={t('หน่วยที่เลือกได้ตอนกรอก')}
        description={t('ตัวเลือกหน่วยในหน้ารับเข้า / เบิกออก / ปรับสต๊อก / สั่งซื้อ — เป็นชื่อหน่วย ส่วนอัตราแปลง (1 Carton = กี่ EA) ตั้งที่สินค้าแต่ละตัว หรือระบบจะถามครั้งแรกที่คีย์')}
      />
      <div className="flex flex-wrap gap-2">
        {units.map((u) => (
          <span
            key={u}
            className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-sunken py-1 pr-1 pl-3 text-sm font-medium text-ink"
          >
            {u}
            <button
              type="button"
              onClick={() => remove(u)}
              disabled={busy || units.length <= 1}
              aria-label={t('ลบ "{name}"', { name: u })}
              className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-ink-faint outline-none transition-colors duration-150 hover:bg-danger-soft hover:text-danger focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="x" size={14} />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1">
          <Field label={t('เพิ่มหน่วยใหม่')}>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void add()
                }
              }}
              placeholder={t('เช่น Carton')}
              maxLength={20}
            />
          </Field>
        </div>
        <Button variant="secondary" onClick={() => void add()} disabled={busy || !draft.trim()}>
          <Icon name="plus" size={16} />
          {t('เพิ่ม')}
        </Button>
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        {t('ค่าเริ่มต้น: {list}', { list: DEFAULT_UNITS.join(', ') })}
      </p>
    </Card>
  )
}

// ---------------- Cloud connection ----------------
function CloudSection({ mode }: { mode: 'cloud' | 'local' }) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const [input, setInput] = useState('')
  const cfg = getFirebaseConfig()

  function connect() {
    const parsed = parseConfigInput(input)
    if (!parsed) {
      toast.error(t('อ่านค่า config ไม่ได้ — วางทั้งอ็อบเจกต์ firebaseConfig'))
      return
    }
    saveFirebaseConfig(parsed)
    toast.success(t("บันทึกแล้ว กำลังเชื่อมต่อ Cloud..."))
    setTimeout(() => window.location.reload(), 800)
  }

  async function disconnect() {
    const ok = await confirm({
      title: t("ตัดการเชื่อมต่อ Cloud"),
      message: t("กลับไปใช้โหมดในเครื่อง? ข้อมูลบน Cloud ยังอยู่ แต่เครื่องนี้จะไม่ซิงก์"),
      danger: true,
      confirmText: t("ตัดการเชื่อมต่อ"),
    })
    if (!ok) return
    clearFirebaseConfig()
    setTimeout(() => window.location.reload(), 500)
  }

  return (
    <Card className="p-4">
      <SectionHeader
        icon="cloud"
        title={t("การเชื่อมต่อ Cloud")}
        description={t('ที่เก็บข้อมูลของแอปนี้')}
        badge={
          mode === 'cloud' ? (
            <Badge color="green">{t("เชื่อมต่อแล้ว")}</Badge>
          ) : (
            <Badge color="amber">{t("โหมดในเครื่อง")}</Badge>
          )
        }
      />
      {mode === 'cloud' ? (
        <div className="space-y-2 text-sm text-ink-soft">
          <p>
            {t('เชื่อมต่อ Firebase project:')} <span className="font-mono">{cfg?.projectId}</span>{' '}
            {t('— ข้อมูลซิงก์ทุกเครื่องแบบเรียลไทม์')}
          </p>
          <Button variant="secondary" onClick={disconnect}>
            {t("ตัดการเชื่อมต่อ")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-ink-soft">
          <div className="rounded-lg border border-warn/30 bg-warn-soft p-3 text-warn">
            <p className="font-semibold">
              {t("โหมดในเครื่องมีไว้ทดลองใช้ ไม่ใช่สำหรับข้อมูลจริง")}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              <li>{t("รหัสผ่านเก็บในเบราว์เซอร์แบบไม่เข้ารหัส ใครเปิดเครื่องนี้ได้ก็อ่านได้")}</li>
              <li>{t("ไม่มีเซิร์ฟเวอร์ตรวจสิทธิ์ — สิทธิ์ผู้ดูแล/พนักงานเป็นแค่การซ่อนปุ่ม")}</li>
              <li>{t("ข้อมูลอยู่แค่เบราว์เซอร์นี้ ล้างข้อมูลเบราว์เซอร์แล้วหายถาวร")}</li>
            </ul>
            <p className="mt-2 text-xs">{t("สำหรับสต๊อกจริง ให้เชื่อมต่อ Cloud ด้านล่าง")}</p>
          </div>
          <p>
            {t('ตอนนี้ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น หากต้องการใช้หลายเครื่องแบบเรียลไทม์ (ฟรี) ให้สร้าง Firebase project แล้ววาง config ด้านล่าง — ดูวิธีใน README')}
          </p>
          <textarea
            className="w-full rounded-lg border border-line-strong p-2 font-mono text-xs"
            rows={7}
            placeholder={
              '{\n  "apiKey": "...",\n  "authDomain": "xxx.firebaseapp.com",\n  "projectId": "xxx",\n  "appId": "..."\n}'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button onClick={connect}>{t("เชื่อมต่อ Cloud")}</Button>
        </div>
      )}
    </Card>
  )
}

// ---------------- Locations ----------------
function LocationsSection() {
  const t = useT()
  const { locations, rawLocations } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<StockLocation | null>(null)
  const [adding, setAdding] = useState(false)

  async function remove(l: StockLocation) {
    const ok = await confirm({
      title: t("ลบคลัง"),
      message: t('ลบ "{name}" ? ยอดคงเหลือของคลังนี้จะถูกลบด้วย (ประวัติยังอยู่)', { name: l.name, }),
      danger: true,
      confirmText: t("ลบ"),
    })
    if (!ok) return
    try {
      await deleteLocation(l.id)
      toast.success(t("ลบแล้ว"))
    } catch (e) {
      toast.error(t("ลบไม่สำเร็จ:") + ' ' + errText(e, t))
    }
  }

  return (
    <Card className="p-4">
      <SectionHeader
        icon="building"
        title={t("คลัง / สาขา")}
        description={t('สถานที่ที่นับสต๊อกได้ — ทุกการรับเข้า/เบิกออกต้องระบุคลัง')}
        actions={
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />
            {t("เพิ่มคลัง")}
          </Button>
        }
      />
      <div className="divide-y divide-line">
        {locations.map((l) => (
          <div key={l.id} className="flex items-center gap-3 py-2">
            <Icon
              name={l.type === 'warehouse' ? 'package' : 'building'}
              size={18}
              className="text-ink-faint"
            />
            <span className="flex-1 font-medium text-ink">{l.name}</span>
            <Badge color={l.type === 'warehouse' ? 'blue' : 'slate'}>
              {l.type === 'warehouse' ? t("คลังหลัก") : t("สาขา")}
            </Badge>
            <button
              onClick={() => setEditing(rawLocations.find((r) => r.id === l.id) ?? l)}
              className={`${rowAction} text-ink-soft hover:bg-sunken hover:text-ink`}
            >
              {t("แก้ไข")}
            </button>
            <button
              onClick={() => remove(l)}
              className={`${rowAction} font-medium text-danger hover:bg-danger-soft`}
            >
              {t("ลบ")}
            </button>
          </div>
        ))}
      </div>
      {(adding || editing) && (
        <LocationEditor
          location={editing}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
        />
      )}
    </Card>
  )
}

function LocationEditor({
  location,
  onClose,
}: {
  location: StockLocation | null
  onClose: () => void
}) {
  const t = useT()
  const toast = useToast()
  const [name, setName] = useState(location?.name ?? '')
  const [nameEn, setNameEn] = useState(location?.nameEn ?? '')
  const [type, setType] = useState<LocationType>(location?.type ?? 'branch')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) return toast.error(t("ใส่ชื่อคลัง"))
    setBusy(true)
    try {
      if (location) await updateLocation(location.id, { name, nameEn, type })
      else await createLocation(name, type, nameEn)
      toast.success(t("บันทึกแล้ว"))
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={location ? t("แก้ไขคลัง") : t("เพิ่มคลัง")}>
      <div className="space-y-4">
        <Field label={t("ชื่อคลัง/สาขา")} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('ชื่อภาษาอังกฤษ')} hint={t('แสดงแทนชื่อไทยเมื่อเปิดแอปเป็นภาษาอังกฤษ')}>
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="e.g. Main Warehouse" />
        </Field>
        <Field label={t("ประเภท")}>
          <Select value={type} onChange={(e) => setType(e.target.value as LocationType)}>
            <option value="warehouse">{t("คลังหลัก (Warehouse)")}</option>
            <option value="branch">{t('สาขา (Branch)')}</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("ยกเลิก")}
          </Button>
          <Button onClick={save} disabled={busy}>
            {t("บันทึก")}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------- Users ----------------
function UsersSection({ currentUserId }: { currentUserId: string }) {
  const t = useT()
  const { users, locations } = useData()
  const [sitesFor, setSitesFor] = useState<string | null>(null)
  // Removed accounts, so a mistaken removal is undoable. Nothing lets them back in on
  // their own — an admin has to lift it here first.
  const [revoked, setRevoked] = useState<RevokedUser[]>([])
  const [revokedErr, setRevokedErr] = useState('')
  const reloadRevoked = useCallback(() => {
    listRevoked().then(setRevoked, (e) => setRevokedErr(errText(e, t)))
  }, [t])
  useEffect(reloadRevoked, [reloadRevoked])
  const toast = useToast()
  const confirm = useConfirm()
  const [adding, setAdding] = useState(false)

  // Changing a role or switching someone off is exactly the kind of write the rules can
  // refuse. Silently doing nothing left the admin thinking it had worked.
  async function toggleActive(id: string, active: boolean) {
    try {
      await updateUserProfile(id, { active })
    } catch (e) {
      toast.error(t("บันทึกไม่สำเร็จ:") + ' ' + errText(e, t))
    }
  }
  async function setRole(id: string, role: Role) {
    try {
      await updateUserProfile(id, { role })
    } catch (e) {
      toast.error(t("บันทึกไม่สำเร็จ:") + ' ' + errText(e, t))
    }
  }
  /**
   * Which sites someone works at (24 Sep 2026): what they may send from and receive at in
   * ระบบส่งสินค้า. None = every site (owner's rule). Users are shared by both companies, so
   * the other company's sites are kept as they are.
   */
  async function setSites(u: AppUser, chosen: string[]) {
    const here = new Set(locations.map((l) => l.id))
    const kept = (u.siteIds ?? []).filter((id) => !here.has(id))
    try {
      await updateUserProfile(u.id, { siteIds: [...kept, ...chosen] })
      setSitesFor(null)
    } catch (e) {
      toast.error(t("บันทึกไม่สำเร็จ:") + ' ' + errText(e, t))
    }
  }
  async function removeUser(u: { id: string; name: string }) {
    const ok = await confirm({
      title: t("ลบผู้ใช้"),
      message: t('ลบผู้ใช้ "{name}" ? ผู้ใช้นี้จะเข้าระบบไม่ได้อีก แม้จะสมัครใหม่ด้วยอีเมลเดิม (ประวัติการทำรายการที่ผ่านมายังคงอยู่)', { name: u.name }),
      danger: true,
      confirmText: t("ลบผู้ใช้"),
    })
    if (!ok) return
    try {
      await deleteUser(u.id, currentUserId)
      reloadRevoked()
      toast.success(t("ลบผู้ใช้แล้ว"))
    } catch (e) {
      toast.error(t("ลบไม่สำเร็จ:") + ' ' + errText(e, t))
    }
  }

  async function undoRemoval(r: RevokedUser) {
    try {
      await restoreUser(r.id)
      reloadRevoked()
      toast.success(t("คืนสิทธิ์แล้ว — ผู้ใช้ต้องขอสิทธิ์เข้าใช้งานใหม่อีกครั้ง"))
    } catch (e) {
      toast.error(t("คืนสิทธิ์ไม่สำเร็จ:") + ' ' + errText(e, t))
    }
  }

  return (
    <Card className="p-4">
      <SectionHeader
        icon="users"
        title={t("ผู้ใช้งาน")}
        description={t('ใครเข้าระบบได้บ้าง และมีสิทธิ์ระดับไหน')}
        actions={
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />
            {t("เพิ่มผู้ใช้")}
          </Button>
        }
      />
      <div className="divide-y divide-line">
        {users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-ink">
                {u.name}
                {u.id === currentUserId && (
                  <span className="ml-1 text-xs text-ink-faint">{t("(คุณ)")}</span>
                )}
              </div>
              <div className="text-xs text-ink-faint">{u.email}</div>
              <div className="text-xs text-ink-soft">
                {t('สาขา')}:{' '}
                {(u.siteIds ?? []).filter((id) => locations.some((l) => l.id === id)).length === 0
                  ? t('ทุกสาขา')
                  : locations.filter((l) => u.siteIds?.includes(l.id)).map((l) => l.name).join(', ')}
              </div>
            </div>
            <button onClick={() => setSitesFor(sitesFor === u.id ? null : u.id)} className={`${rowAction} text-ink-soft hover:bg-sunken`}>
              {t('กำหนดสาขา')}
            </button>
            <Select
              value={u.role}
              onChange={(e) => setRole(u.id, e.target.value as Role)}
              className="w-32"
              disabled={u.id === currentUserId}
            >
              <option value="admin">{t("ผู้ดูแล")}</option>
              <option value="manager">{t('หัวหน้า')}</option>
              <option value="staff">{t("พนักงาน")}</option>
            </Select>
            {u.active === false ? (
              <button
                onClick={() => toggleActive(u.id, true)}
                className={`${rowAction} font-medium text-in hover:bg-in-soft`}
              >
                {t("เปิดใช้")}
              </button>
            ) : (
              <button
                onClick={() => toggleActive(u.id, false)}
                className={`${rowAction} text-danger hover:bg-danger-soft`}
                disabled={u.id === currentUserId}
              >
                {t("ปิดใช้")}
              </button>
            )}
            {u.id !== currentUserId && (
              <button
                onClick={() => removeUser(u)}
                className={`${rowAction} font-medium text-danger hover:bg-danger-soft`}
              >
                {t("ลบ")}
              </button>
            )}
            {sitesFor === u.id && <SitesPicker user={u} locations={locations} onSave={(ids) => setSites(u, ids)} onCancel={() => setSitesFor(null)} />}
          </div>
        ))}
      </div>
      {revoked.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="mb-2 text-sm font-semibold text-ink-soft">{t("บัญชีที่ถูกถอนสิทธิ์")}</h3>
          <p className="mb-2 text-xs text-ink-faint">
            {t("บัญชีเหล่านี้เข้าระบบไม่ได้และสมัครใหม่ด้วยอีเมลเดิมไม่ได้ จนกว่าจะคืนสิทธิ์")}
          </p>
          <div className="divide-y divide-line">
            {revoked.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft">
                  {r.id}
                </div>
                <button
                  onClick={() => undoRemoval(r)}
                  className="text-sm font-medium text-in hover:underline"
                >
                  {t("คืนสิทธิ์")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {revokedErr && <p className="mt-2 text-xs text-danger">{revokedErr}</p>}
      {adding && (
        <UserEditor
          onClose={() => setAdding(false)}
          onDone={() => toast.success(t("เพิ่มผู้ใช้แล้ว"))}
        />
      )}
    </Card>
  )
}

/** Tick the sites someone works at; none ticked = every site. */
function SitesPicker({
  user,
  locations,
  onSave,
  onCancel,
}: {
  user: AppUser
  locations: StockLocation[]
  onSave: (ids: string[]) => void
  onCancel: () => void
}) {
  const t = useT()
  const [chosen, setChosen] = useState<string[]>(() => locations.filter((l) => user.siteIds?.includes(l.id)).map((l) => l.id))
  return (
    <div className="w-full rounded-lg bg-sunken p-3">
      <p className="mb-2 text-xs text-ink-soft">{t('ไม่ติ๊กเลย = ทำรายการได้ทุกสาขา')}</p>
      <div className="flex flex-wrap gap-3">
        {locations
          .filter((l) => l.active !== false)
          .map((l) => (
            <label key={l.id} className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={chosen.includes(l.id)}
                onChange={(e) => setChosen(e.target.checked ? [...chosen, l.id] : chosen.filter((x) => x !== l.id))}
              />
              {l.name}
            </label>
          ))}
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('ยกเลิก')}
        </Button>
        <Button size="sm" onClick={() => onSave(chosen)}>
          {t('บันทึก')}
        </Button>
      </div>
    </div>
  )
}

function UserEditor({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT()
  const toast = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('staff')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim() || !email.trim() || password.length < 6)
      return toast.error(t("กรอกชื่อ อีเมล และรหัสผ่าน (≥6 ตัว)"))
    setBusy(true)
    try {
      await createUser({ name, email, password, role })
      onDone()
      onClose()
    } catch (e) {
      toast.error(t("สร้างไม่สำเร็จ:") + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t("เพิ่มผู้ใช้")}>
      <div className="space-y-4">
        <Field label={t("ชื่อ")} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("อีเมล")} required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t("รหัสผ่าน")} required hint={t("อย่างน้อย 6 ตัวอักษร")}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={t("สิทธิ์")}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="staff">{t("พนักงาน (รับ/เบิก/ดู)")}</option>
            <option value="manager">{t('หัวหน้า (อนุมัติรายการขอสั่งซื้อ)')}</option>
            <option value="admin">{t("ผู้ดูแล (จัดการทั้งหมด)")}</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("ยกเลิก")}
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? t("กำลังสร้าง...") : t("สร้างผู้ใช้")}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------- Maintenance ----------------
function MaintenanceSection({ actor }: { actor: { id: string; name: string } }) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState('')
  // null = not checked yet, [] = checked and everything agrees
  const [drift, setDrift] = useState<LevelDrift[] | null>(null)
  const { products, locationById } = useData()
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  async function checkIntegrity() {
    setBusy('check')
    try {
      setDrift(await findLevelDrift())
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  async function recompute() {
    setBusy('recompute')
    try {
      await recomputeLevels(actor)
      // What it just wrote came straight from the ledger it just read, so it agrees with
      // it by construction — asking findLevelDrift() to read the whole thing again to
      // confirm that would be the exact waste this tool exists to fix (22 Sep 2026).
      setDrift([])
      toast.success(t("คำนวณยอดคงเหลือใหม่จากประวัติเรียบร้อย"))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  /**
   * Put every purchase order's number right: each supplier's orders count 1, 2, 3 in the
   * order they were placed (the owner's rule, 15 Sep 2026). Shows what would change and
   * asks before touching anything; the numbers are what suppliers see on the sheet.
   */
  async function renumber() {
    setBusy('renumber')
    try {
      const { renumberPlan, listOrdersInRange, renumberOrdersPerSupplier } = await import('../services/purchaseOrders')
      const all = await listOrdersInRange(0, Date.now() + 86_400_000)
      const plan = renumberPlan(all)
      if (plan.changes.length === 0) {
        toast.success(t('เลขใบสั่งซื้อถูกต้องตามผู้ขายทุกใบแล้ว'))
        return
      }
      const preview = plan.changes
        .slice(0, 12)
        .map((c) => `${c.supplierName}: ${c.from} → ${c.to}`)
        .join('\n')
      const ok = await confirm({
        title: t('จัดเลขใบสั่งซื้อใหม่ตามผู้ขาย'),
        message:
          t('จะเปลี่ยนเลข {n} ใบ ให้แต่ละผู้ขายนับ 1, 2, 3 ตามลำดับที่สั่ง เลขที่เคยส่งให้ผู้ขายไปแล้วจะไม่ตรงกับในระบบ', { n: plan.changes.length }) +
          '\n\n' +
          preview +
          (plan.changes.length > 12 ? '\n…' : ''),
        danger: true,
        confirmText: t('จัดเลขใหม่'),
      })
      if (!ok) return
      const { changed, failed } = await renumberOrdersPerSupplier()
      if (failed.length === 0) {
        toast.success(t('จัดเลขใหม่แล้ว {n} ใบ — ใบใหม่ของแต่ละผู้ขายจะนับต่อจากนี้', { n: changed.length }))
      } else {
        await confirm({
          title: t('จัดเลขใหม่ไม่ครบ'),
          message:
            t('เปลี่ยนแล้ว {ok} ใบ ไม่สำเร็จ {bad} ใบ — ตัวนับเลขยังไม่ถูกปรับ กดจัดเลขใหม่อีกครั้งได้ ถ้ายังไม่ผ่านให้ส่งข้อความนี้ให้ผู้ดูแล', { ok: changed.length, bad: failed.length }) +
            '\n\n' +
            failed.slice(0, 8).map((f) => `${f.supplierName}: ${f.from} → ${f.to} — ${f.error}`).join('\n'),
          confirmText: t('ปิด'),
        })
      }
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  /**
   * Received orders stamped with the day they were keyed instead of the delivery date
   * (a bug until 17 Sep 2026). The stock movement has the right date; copy it back.
   */
  async function repairReceived() {
    setBusy('received')
    try {
      const { repairReceivedDates } = await import('../services/purchaseOrders')
      const r = await repairReceivedDates()
      toast.success(
        r.fixed === 0
          ? t('วันที่รับของตรงกับใบรับสินค้าทุกใบแล้ว ({n} ใบ)', { n: r.checked })
          : t('แก้วันที่รับของแล้ว {fixed} จาก {n} ใบ', { fixed: r.fixed, n: r.checked }),
      )
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  async function seed() {
    const ok = await confirm({
      message: t("นำเข้าแคตตาล็อกสินค้า + คลังเริ่มต้น? (ข้ามถ้ามีข้อมูลอยู่แล้ว)"),
      confirmText: t("นำเข้า"),
    })
    if (!ok) return
    setBusy('seed')
    try {
      const r = await seedInitialData()
      toast.success(
        t('นำเข้าสินค้า {products}, คลัง {locations}', { products: r.products, locations: r.locations, }),
      )
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <Card className="p-4">
      <SectionHeader
        icon="refresh"
        title={t("ดูแลข้อมูล")}
        description={t('เครื่องมือซ่อมข้อมูล ใช้เมื่อยอดคงเหลือไม่ตรงกับประวัติ')}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={seed} disabled={!!busy}>
          {busy === 'seed' ? t("กำลังนำเข้า...") : t("นำเข้าแคตตาล็อกสินค้า")}
        </Button>
        <Button variant="secondary" onClick={recompute} disabled={!!busy}>
          {busy === 'recompute' ? t("กำลังคำนวณ...") : t("คำนวณยอดคงเหลือใหม่")}
        </Button>
        <Button variant="secondary" onClick={checkIntegrity} disabled={!!busy}>
          {busy === 'check' ? t("กำลังตรวจ...") : t("ตรวจความสอดคล้องของยอด")}
        </Button>
        <Button variant="secondary" onClick={renumber} disabled={!!busy}>
          {busy === 'renumber' ? t('กำลังตรวจเลข...') : t('จัดเลขใบสั่งซื้อใหม่ตามผู้ขาย')}
        </Button>
        <Button variant="secondary" onClick={repairReceived} disabled={!!busy}>
          {busy === 'received' ? t('กำลังตรวจวันที่...') : t('ซ่อมวันที่รับของตามใบรับสินค้า')}
        </Button>
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        {t('“คำนวณยอดคงเหลือใหม่” และ “ตรวจความสอดคล้องของยอด” อ่านประวัติการเคลื่อนไหวทั้งหมดของแบรนด์นี้ทุกครั้งที่กด — ใช้เมื่อสงสัยว่ายอดไม่ตรงจริง ๆ ไม่ควรกดซ้ำหลายครั้งติดกันโดยไม่จำเป็น (มีผลต่อโควตาการอ่านข้อมูลรายวัน)')}
      </p>

      {drift !== null && (
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="mb-1 text-sm font-semibold text-ink">{t("ผลตรวจความสอดคล้องของยอด")}</h3>
          <p className="mb-3 text-xs text-ink-faint">
            {t('เทียบยอดคงเหลือที่เก็บไว้กับผลรวมจากประวัติ ประวัติคือข้อมูลจริงเสมอ — ระบบตรวจเจอและซ่อมได้ แต่ป้องกันการแก้ยอดตรง ๆ ไม่ได้บนแพ็กเกจฟรี')}
          </p>
          {drift.length === 0 ? (
            <p className="text-sm font-medium text-in">{t("ยอดคงเหลือตรงกับประวัติทุกรายการ")}</p>
          ) : (
            <>
              <p className="mb-2 text-sm text-danger">
                {t('พบ {count} รายการที่ไม่ตรง — กด “คำนวณยอดคงเหลือใหม่” เพื่อซ่อมจากประวัติ', { count: drift.length, })}
              </p>
              <DataTable
                rows={drift.slice(0, 50)}
                columns={[
                  {
                    key: 'product',
                    header: t('สินค้า'),
                    primary: true,
                    cell: (d) =>
                      // A balance whose product is gone reads as a bare id, which tells
                      // nobody anything. Say what it is: leftover from a deleted product,
                      // which is the usual reason a balance has no history.
                      productById.get(d.productId)?.name ?? (
                        <>
                          <span className="text-warn">{t('(สินค้าถูกลบไปแล้ว)')}</span>
                          <span className="ml-1 font-mono text-xs text-ink-faint">
                            {d.productId}
                          </span>
                        </>
                      ),
                  },
                  {
                    key: 'location',
                    header: t('คลัง'),
                    cell: (d) => locationById(d.locationId)?.name ?? d.locationId,
                  },
                  {
                    key: 'cached',
                    header: t('ยอดที่เก็บไว้'),
                    align: 'right',
                    className: 'num font-medium text-danger',
                    cell: (d) => d.cached,
                  },
                  {
                    key: 'ledger',
                    header: t('ยอดตามประวัติ'),
                    align: 'right',
                    className: 'num text-ink',
                    cell: (d) => d.fromLedger,
                  },
                  {
                    key: 'by',
                    header: t('แก้ล่าสุดโดย'),
                    className: 'font-mono text-xs text-ink-faint',
                    cell: (d) => d.updatedBy ?? t('(ไม่ระบุ)'),
                  },
                ]}
                rowKey={(d) => d.id}
                minWidth={520}
              />
              {drift.length > 50 && (
                <p className="mt-2 text-xs text-ink-faint">
                  {t('แสดง 50 รายการแรกจาก {count}', { count: drift.length })}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  )
}
