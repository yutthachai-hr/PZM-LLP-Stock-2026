import { useEffect, useMemo, useRef, useState } from 'react'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Button, Card, Field, Input, Select, Textarea } from '../components/ui'
import { LineBuilder, type Line } from '../components/LineBuilder'
import { issueStock, consumeStock } from '../services/stock'
import { compressImage } from '../lib/image'
import { dateInputToMs, msToDateInput, todayMs } from '../lib/format'

type Mode = 'transfer' | 'consume'

export function IssuePage() {
  const [mode, setMode] = useState<Mode>('transfer')

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">🚚 เบิก / โอน / ตัดออก</h1>
        <p className="text-sm text-slate-500">
          โอนของไปเก็บที่สาขา หรือเบิกของออกจากคลังไปใช้/ขายหน้าร้าน — ตัดสต๊อกอัตโนมัติ
        </p>
      </div>

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        <Tab label="โอนไปสาขา (เก็บสต๊อก)" active={mode === 'transfer'} onClick={() => setMode('transfer')} />
        <Tab label="เบิกใช้ / ตัดออก (หน้าร้าน)" active={mode === 'consume'} onClick={() => setMode('consume')} />
      </div>

      {mode === 'transfer' ? <TransferForm /> : <ConsumeForm />}
    </div>
  )
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-white text-red-700 shadow-sm' : 'text-slate-600'
      }`}
    >
      {label}
    </button>
  )
}

// ------------------------------------------------------------------ Transfer
function TransferForm() {
  const { products, locations, qtyAt } = useData()
  const { user } = useAuth()
  const toast = useToast()

  const active = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  const defaultFrom = active.find((l) => l.type === 'warehouse') ?? active[0]

  const [fromLocationId, setFromLocationId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [dateStr, setDateStr] = useState(msToDateInput(todayMs()))
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!fromLocationId && defaultFrom) setFromLocationId(defaultFrom.id)
  }, [fromLocationId, defaultFrom])
  useEffect(() => {
    if (!toLocationId) {
      const branch = active.find((l) => l.type === 'branch' && l.id !== fromLocationId)
      if (branch) setToLocationId(branch.id)
    }
  }, [toLocationId, active, fromLocationId])

  const availableAt = (productId: string) => qtyAt(fromLocationId, productId)

  async function submit() {
    if (!fromLocationId || !toLocationId) return toast.error('เลือกต้นทางและปลายทาง')
    if (fromLocationId === toLocationId) return toast.error('ต้นทางและปลายทางต้องต่างกัน')
    if (lines.length === 0) return toast.error('เพิ่มรายการสินค้าก่อน')
    if (lines.some((l) => !(l.qty > 0))) return toast.error('จำนวนต้องมากกว่า 0')
    const over = lines.find((l) => l.qty > availableAt(l.productId))
    if (over) return toast.error(`สต๊อกไม่พอสำหรับ "${over.productName}"`)

    setBusy(true)
    try {
      const docNo = await issueStock({
        lines,
        fromLocationId,
        toLocationId,
        date: dateInputToMs(dateStr),
        actor: { id: user!.id, name: user!.name },
        note: note.trim() || undefined,
      })
      toast.success(`เบิก/โอนเรียบร้อย (เลขที่ ${docNo})`)
      setLines([])
      setNote('')
    } catch (e) {
      toast.error('บันทึกไม่สำเร็จ: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="จากคลัง (ต้นทาง)" required>
          <Select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
            {active.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ไปยังสาขา (ปลายทาง)" required>
          <Select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
            <option value="">— เลือก —</option>
            {active
              .filter((l) => l.id !== fromLocationId)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="วันที่เบิก" required>
          <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
        </Field>
        <Field label="ผู้เบิก (บันทึกอัตโนมัติ)">
          <Input value={user?.name ?? ''} disabled />
        </Field>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">รายการสินค้า</div>
        <LineBuilder products={products} lines={lines} onChange={setLines} availableAt={availableAt} />
      </div>

      <Field label="หมายเหตุ (ไม่บังคับ)">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={busy}>
          {busy ? 'กำลังบันทึก...' : `บันทึกโอนไปสาขา (${lines.length} รายการ)`}
        </Button>
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ Consume
function ConsumeForm() {
  const { products, locations, qtyAt } = useData()
  const { user } = useAuth()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const active = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  const defaultFrom = active.find((l) => l.type === 'warehouse') ?? active[0]

  const [fromLocationId, setFromLocationId] = useState('')
  const [dateStr, setDateStr] = useState(msToDateInput(todayMs()))
  const [note, setNote] = useState('สุขุมวิท')
  const [lines, setLines] = useState<Line[]>([])
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!fromLocationId && defaultFrom) setFromLocationId(defaultFrom.id)
  }, [fromLocationId, defaultFrom])

  const availableAt = (productId: string) => qtyAt(fromLocationId, productId)

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setPhoto(await compressImage(file))
    } catch {
      toast.error('อ่านรูปไม่สำเร็จ')
    }
  }

  async function submit() {
    if (!fromLocationId) return toast.error('เลือกคลังต้นทาง')
    if (lines.length === 0) return toast.error('เพิ่มรายการสินค้าก่อน')
    if (lines.some((l) => !(l.qty > 0))) return toast.error('จำนวนต้องมากกว่า 0')
    const over = lines.find((l) => l.qty > availableAt(l.productId))
    if (over) return toast.error(`สต๊อกไม่พอสำหรับ "${over.productName}"`)

    setBusy(true)
    try {
      const docNo = await consumeStock({
        lines,
        fromLocationId,
        date: dateInputToMs(dateStr),
        actor: { id: user!.id, name: user!.name },
        note: note.trim() || undefined,
        photoDataUrl: photo ?? undefined,
      })
      toast.success(`บันทึกเบิกใช้เรียบร้อย (เลขที่ ${docNo})`)
      setLines([])
      setPhoto(null)
    } catch (e) {
      toast.error('บันทึกไม่สำเร็จ: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        เบิกของออกจากคลังไปใช้/ขายหน้าร้าน (เช่น สาขาสุขุมวิทที่อยู่ที่เดียวกับคลัง) — ตัดสต๊อกออก ไม่เพิ่มเข้าสาขาอื่น
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="เบิกจากคลัง" required>
          <Select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
            {active.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="วันที่เบิก" required>
          <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
        </Field>
        <Field label="ผู้เบิก (บันทึกอัตโนมัติ)">
          <Input value={user?.name ?? ''} disabled />
        </Field>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">รายการสินค้าที่เบิก</div>
        <LineBuilder products={products} lines={lines} onChange={setLines} availableAt={availableAt} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="เบิกไปใช้ที่ / หมายเหตุ">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น สุขุมวิท" />
        </Field>
        <Field label="รูปหลักฐาน (แนบได้ทุกครั้ง)">
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={pickPhoto}
            />
            {photo ? (
              <img
                src={photo}
                alt="หลักฐาน"
                className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-300">
                📷
              </div>
            )}
            <div className="space-y-1">
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                📷 ถ่าย / เลือกรูป
              </Button>
              {photo && (
                <button
                  onClick={() => setPhoto(null)}
                  className="block text-xs text-rose-500 hover:underline"
                >
                  ลบรูป
                </button>
              )}
            </div>
          </div>
        </Field>
      </div>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={busy} variant="danger">
          {busy ? 'กำลังบันทึก...' : `บันทึกเบิกใช้ (${lines.length} รายการ)`}
        </Button>
      </div>
    </Card>
  )
}
