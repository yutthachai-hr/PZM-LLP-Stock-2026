import { useState } from 'react'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Select,
} from '../components/ui'
import {
  createLocation,
  updateLocation,
  deleteLocation,
} from '../services/locations'
import { createUser, updateUserProfile, deleteUser } from '../services/users'
import { recomputeLevels } from '../services/stock'
import { seedInitialData } from '../services/seed'
import {
  clearFirebaseConfig,
  getFirebaseConfig,
  parseConfigInput,
  saveFirebaseConfig,
} from '../firebase/config'
import type { LocationType, StockLocation, Role } from '../types'

export function SettingsPage() {
  const { user, mode } = useAuth()
  const isAdmin = user?.role === 'admin'

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold text-slate-800">⚙️ ตั้งค่า</h1>

      <CloudSection mode={mode} />

      {isAdmin && <LocationsSection />}
      {isAdmin && <UsersSection currentUserId={user!.id} />}
      {isAdmin && <MaintenanceSection />}

      {!isAdmin && (
        <Card className="p-4 text-sm text-slate-500">
          การจัดการคลัง ผู้ใช้ และข้อมูล ต้องเป็นสิทธิ์ผู้ดูแลระบบ (Admin)
        </Card>
      )}
    </div>
  )
}

// ---------------- Cloud connection ----------------
function CloudSection({ mode }: { mode: 'cloud' | 'local' }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [input, setInput] = useState('')
  const cfg = getFirebaseConfig()

  function connect() {
    const parsed = parseConfigInput(input)
    if (!parsed) {
      toast.error('อ่านค่า config ไม่ได้ — วางทั้งอ็อบเจกต์ firebaseConfig')
      return
    }
    saveFirebaseConfig(parsed)
    toast.success('บันทึกแล้ว กำลังเชื่อมต่อ Cloud...')
    setTimeout(() => window.location.reload(), 800)
  }

  async function disconnect() {
    const ok = await confirm({
      title: 'ตัดการเชื่อมต่อ Cloud',
      message: 'กลับไปใช้โหมดในเครื่อง? ข้อมูลบน Cloud ยังอยู่ แต่เครื่องนี้จะไม่ซิงก์',
      danger: true,
      confirmText: 'ตัดการเชื่อมต่อ',
    })
    if (!ok) return
    clearFirebaseConfig()
    setTimeout(() => window.location.reload(), 500)
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-semibold text-slate-800">การเชื่อมต่อ Cloud</h2>
        {mode === 'cloud' ? <Badge color="green">เชื่อมต่อแล้ว</Badge> : <Badge color="amber">โหมดในเครื่อง</Badge>}
      </div>
      {mode === 'cloud' ? (
        <div className="space-y-2 text-sm text-slate-600">
          <p>
            เชื่อมต่อ Firebase project: <span className="font-mono">{cfg?.projectId}</span> — ข้อมูลซิงก์
            ทุกเครื่องแบบเรียลไทม์
          </p>
          <Button variant="secondary" onClick={disconnect}>
            ตัดการเชื่อมต่อ
          </Button>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            ตอนนี้ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น หากต้องการใช้หลายเครื่องแบบเรียลไทม์ (ฟรี) ให้สร้าง Firebase
            project แล้ววาง config ด้านล่าง — ดูวิธีใน README
          </p>
          <textarea
            className="w-full rounded-lg border border-slate-300 p-2 font-mono text-xs"
            rows={7}
            placeholder={'{\n  "apiKey": "...",\n  "authDomain": "xxx.firebaseapp.com",\n  "projectId": "xxx",\n  "appId": "..."\n}'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button onClick={connect}>เชื่อมต่อ Cloud</Button>
        </div>
      )}
    </Card>
  )
}

// ---------------- Locations ----------------
function LocationsSection() {
  const { locations } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<StockLocation | null>(null)
  const [adding, setAdding] = useState(false)

  async function remove(l: StockLocation) {
    const ok = await confirm({
      title: 'ลบคลัง',
      message: `ลบ "${l.name}" ? ยอดคงเหลือของคลังนี้จะถูกลบด้วย (ประวัติยังอยู่)`,
      danger: true,
      confirmText: 'ลบ',
    })
    if (!ok) return
    await deleteLocation(l.id)
    toast.success('ลบแล้ว')
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">คลัง / สาขา</h2>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          + เพิ่มคลัง
        </Button>
      </div>
      <div className="divide-y divide-slate-100">
        {locations.map((l) => (
          <div key={l.id} className="flex items-center gap-3 py-2">
            <span className="text-lg">{l.type === 'warehouse' ? '🏭' : '🏬'}</span>
            <span className="flex-1 font-medium text-slate-700">{l.name}</span>
            <Badge color={l.type === 'warehouse' ? 'blue' : 'slate'}>
              {l.type === 'warehouse' ? 'คลังหลัก' : 'สาขา'}
            </Badge>
            <button onClick={() => setEditing(l)} className="text-sm text-slate-500 hover:text-slate-700">
              แก้ไข
            </button>
            <button onClick={() => remove(l)} className="text-sm text-rose-500 hover:text-rose-700">
              ลบ
            </button>
          </div>
        ))}
      </div>
      {(adding || editing) && (
        <LocationEditor location={editing} onClose={() => { setAdding(false); setEditing(null) }} />
      )}
    </Card>
  )
}

function LocationEditor({ location, onClose }: { location: StockLocation | null; onClose: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(location?.name ?? '')
  const [type, setType] = useState<LocationType>(location?.type ?? 'branch')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) return toast.error('ใส่ชื่อคลัง')
    setBusy(true)
    try {
      if (location) await updateLocation(location.id, { name, type })
      else await createLocation(name, type)
      toast.success('บันทึกแล้ว')
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={location ? 'แก้ไขคลัง' : 'เพิ่มคลัง'}>
      <div className="space-y-4">
        <Field label="ชื่อคลัง/สาขา" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="ประเภท">
          <Select value={type} onChange={(e) => setType(e.target.value as LocationType)}>
            <option value="warehouse">คลังหลัก (Warehouse)</option>
            <option value="branch">สาขา (Branch)</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
          <Button onClick={save} disabled={busy}>บันทึก</Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------- Users ----------------
function UsersSection({ currentUserId }: { currentUserId: string }) {
  const { users } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const [adding, setAdding] = useState(false)

  async function toggleActive(id: string, active: boolean) {
    await updateUserProfile(id, { active })
  }
  async function setRole(id: string, role: Role) {
    await updateUserProfile(id, { role })
  }
  async function removeUser(u: { id: string; name: string }) {
    const ok = await confirm({
      title: 'ลบผู้ใช้',
      message: `ลบผู้ใช้ "${u.name}" ? ผู้ใช้นี้จะเข้าระบบไม่ได้อีก (ประวัติการทำรายการที่ผ่านมายังคงอยู่)`,
      danger: true,
      confirmText: 'ลบผู้ใช้',
    })
    if (!ok) return
    try {
      await deleteUser(u.id)
      toast.success('ลบผู้ใช้แล้ว')
    } catch (e) {
      toast.error('ลบไม่สำเร็จ: ' + (e as Error).message)
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">ผู้ใช้งาน</h2>
        <Button variant="secondary" onClick={() => setAdding(true)}>+ เพิ่มผู้ใช้</Button>
      </div>
      <div className="divide-y divide-slate-100">
        {users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-700">
                {u.name}
                {u.id === currentUserId && <span className="ml-1 text-xs text-slate-400">(คุณ)</span>}
              </div>
              <div className="text-xs text-slate-400">{u.email}</div>
            </div>
            <Select
              value={u.role}
              onChange={(e) => setRole(u.id, e.target.value as Role)}
              className="w-32"
              disabled={u.id === currentUserId}
            >
              <option value="admin">ผู้ดูแล</option>
              <option value="staff">พนักงาน</option>
            </Select>
            {u.active === false ? (
              <button onClick={() => toggleActive(u.id, true)} className="text-sm text-emerald-600">
                เปิดใช้
              </button>
            ) : (
              <button
                onClick={() => toggleActive(u.id, false)}
                className="text-sm text-rose-500 disabled:opacity-40"
                disabled={u.id === currentUserId}
              >
                ปิดใช้
              </button>
            )}
            {u.id !== currentUserId && (
              <button
                onClick={() => removeUser(u)}
                className="text-sm font-medium text-rose-600 hover:underline"
              >
                ลบ
              </button>
            )}
          </div>
        ))}
      </div>
      {adding && <UserEditor onClose={() => setAdding(false)} onDone={() => toast.success('เพิ่มผู้ใช้แล้ว')} />}
    </Card>
  )
}

function UserEditor({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('staff')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim() || !email.trim() || password.length < 6)
      return toast.error('กรอกชื่อ อีเมล และรหัสผ่าน (≥6 ตัว)')
    setBusy(true)
    try {
      await createUser({ name, email, password, role })
      onDone()
      onClose()
    } catch (e) {
      toast.error('สร้างไม่สำเร็จ: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="เพิ่มผู้ใช้">
      <div className="space-y-4">
        <Field label="ชื่อ" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="อีเมล" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="รหัสผ่าน" required hint="อย่างน้อย 6 ตัวอักษร">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="สิทธิ์">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="staff">พนักงาน (รับ/เบิก/ดู)</option>
            <option value="admin">ผู้ดูแล (จัดการทั้งหมด)</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'กำลังสร้าง...' : 'สร้างผู้ใช้'}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------- Maintenance ----------------
function MaintenanceSection() {
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState('')

  async function recompute() {
    setBusy('recompute')
    try {
      await recomputeLevels()
      toast.success('คำนวณยอดคงเหลือใหม่จากประวัติเรียบร้อย')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  async function seed() {
    const ok = await confirm({
      message: 'นำเข้าแคตตาล็อกสินค้า + คลังเริ่มต้น? (ข้ามถ้ามีข้อมูลอยู่แล้ว)',
      confirmText: 'นำเข้า',
    })
    if (!ok) return
    setBusy('seed')
    try {
      const r = await seedInitialData()
      toast.success(`นำเข้าสินค้า ${r.products}, คลัง ${r.locations}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 font-semibold text-slate-800">ดูแลข้อมูล</h2>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={seed} disabled={!!busy}>
          {busy === 'seed' ? 'กำลังนำเข้า...' : 'นำเข้าแคตตาล็อกสินค้า'}
        </Button>
        <Button variant="secondary" onClick={recompute} disabled={!!busy}>
          {busy === 'recompute' ? 'กำลังคำนวณ...' : 'คำนวณยอดคงเหลือใหม่'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        “คำนวณยอดคงเหลือใหม่” จะสร้างยอดคงเหลือจากประวัติการเคลื่อนไหวทั้งหมด (ใช้เมื่อสงสัยว่ายอดไม่ตรง)
      </p>
    </Card>
  )
}
