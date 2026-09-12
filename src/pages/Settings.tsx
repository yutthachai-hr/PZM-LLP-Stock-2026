import { useCallback, useEffect, useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { BackupSection } from '../components/BackupSection'
import { Icon } from '../components/Icon'
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  rowAction,
  SectionHeader,
  Select,
} from '../components/ui'
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
import type { LocationType, StockLocation, Role } from '../types'
import { DataTable } from '../components/DataTable'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'

export function SettingsPage() {
  const t = useT()
  const { user, mode } = useAuth()
  const isAdmin = user?.role === 'admin'

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader icon="settings" title={t("ตั้งค่า")} />

      {/* Hidden in a demo build: a config saved here is ignored by getFirebaseConfig(),
          so connecting would silently do nothing. */}
      {!isDemoMode() && <CloudSection mode={mode} />}

      {isAdmin && <LocationsSection />}
      {isAdmin && <UnitsSection />}
      {isAdmin && <UsersSection currentUserId={user!.id} />}
      {isAdmin && <BackupSection />}
      {isAdmin && user && <MaintenanceSection actor={{ id: user.id, name: user.name }} />}

      {!isAdmin && (
        <Card className="p-4 text-sm text-ink-soft">
          {t('การจัดการคลัง ผู้ใช้ และข้อมูล ต้องเป็นสิทธิ์ผู้ดูแลระบบ (Admin)')}
        </Card>
      )}
    </div>
  )
}


// ---------------- Entry units ----------------

/**
 * The words a quantity may be keyed in — Lot, Pack, Carton.
 *
 * These are labels, not conversions: picking one records the number as typed, in the
 * product's own unit. A unit that should multiply belongs on the product as ขนาดบรรจุ,
 * which is per-product because one supplier's carton is not another's.
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
        description={t('ตัวเลือกหน่วยในหน้ารับเข้า / เบิกออก / ปรับสต๊อก — เป็นชื่อหน่วยเฉย ๆ ไม่ได้คูณจำนวน ถ้าต้องการให้คูณ ให้ตั้ง "ขนาดบรรจุ" ที่สินค้าแต่ละตัว')}
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
  const { locations } = useData()
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
              onClick={() => setEditing(l)}
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
  const [type, setType] = useState<LocationType>(location?.type ?? 'branch')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) return toast.error(t("ใส่ชื่อคลัง"))
    setBusy(true)
    try {
      if (location) await updateLocation(location.id, { name, type })
      else await createLocation(name, type)
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
  const { users } = useData()
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
            </div>
            <Select
              value={u.role}
              onChange={(e) => setRole(u.id, e.target.value as Role)}
              className="w-32"
              disabled={u.id === currentUserId}
            >
              <option value="admin">{t("ผู้ดูแล")}</option>
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
      setDrift(await findLevelDrift())
      toast.success(t("คำนวณยอดคงเหลือใหม่จากประวัติเรียบร้อย"))
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
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        {t('“คำนวณยอดคงเหลือใหม่” จะสร้างยอดคงเหลือจากประวัติการเคลื่อนไหวทั้งหมด (ใช้เมื่อสงสัยว่ายอดไม่ตรง)')}
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
