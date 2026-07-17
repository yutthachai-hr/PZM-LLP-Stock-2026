import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Button, Card, Field, Input, Select, Textarea } from '../components/ui'
import { LineBuilder, type Line } from '../components/LineBuilder'
import { receiveStock } from '../services/stock'
import { dateInputToMs, msToDateInput, todayMs } from '../lib/format'

export function ReceivePage() {
  const { products, locations } = useData()
  const { user } = useAuth()
  const toast = useToast()

  const warehouses = useMemo(
    () => locations.filter((l) => l.active !== false),
    [locations],
  )
  const defaultWh = warehouses.find((l) => l.type === 'warehouse') ?? warehouses[0]

  const [toLocationId, setToLocationId] = useState(defaultWh?.id ?? '')
  const [dateStr, setDateStr] = useState(msToDateInput(todayMs()))
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)

  // set the default warehouse once locations have loaded
  useEffect(() => {
    if (!toLocationId && defaultWh) setToLocationId(defaultWh.id)
  }, [toLocationId, defaultWh])

  async function submit() {
    if (!toLocationId) return toast.error('เลือกคลังปลายทาง')
    if (lines.length === 0) return toast.error('เพิ่มรายการสินค้าก่อน')
    if (lines.some((l) => !(l.qty > 0))) return toast.error('จำนวนต้องมากกว่า 0')
    if (!note.trim()) return toast.error('กรุณากรอกเลขบิล/เอกสารส่งของจาก Supplier')
    setBusy(true)
    try {
      const docNo = await receiveStock({
        lines,
        toLocationId,
        date: dateInputToMs(dateStr),
        actor: { id: user!.id, name: user!.name },
        note: note.trim(),
      })
      toast.success(`รับสินค้าเข้าเรียบร้อย (เลขที่ ${docNo})`)
      setLines([])
      setNote('')
    } catch (e) {
      toast.error('บันทึกไม่สำเร็จ: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">📥 รับสินค้าเข้า</h1>
        <p className="text-sm text-slate-500">คีย์รับสินค้าใหม่ → เพิ่มเข้าคลังอัตโนมัติ</p>
      </div>

      <Card className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="คลังปลายทาง" required>
            <Select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
              {warehouses.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="วันที่รับ" required>
            <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
          <Field label="ผู้รับเข้า (บันทึกอัตโนมัติ)">
            <Input value={user?.name ?? ''} disabled />
          </Field>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">รายการสินค้า</div>
          <LineBuilder products={products} lines={lines} onChange={setLines} />
        </div>

        <Field
          label="หมายเหตุ / เลขบิลส่งของ (Supplier)"
          required
          hint="ระบุเลขเอกสารจริงจาก Supplier — เช่น เดล ตาซาโร (ประเทศไทย) จำกัด · Bocconcini 4.5 kg · เลขบิล IV2616876"
        >
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น เดล ตาซาโร (ประเทศไทย) จำกัด / เลขบิล IV2616876"
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button onClick={submit} disabled={busy} variant="success">
            {busy ? 'กำลังบันทึก...' : `บันทึกรับเข้า (${lines.length} รายการ)`}
          </Button>
        </div>
      </Card>
    </div>
  )
}
