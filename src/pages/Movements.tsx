import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select } from '../components/ui'
import { editMovementQty, voidMovement, getMovementImage } from '../services/stock'
import { fmtQty, formatThaiDate, msToDateInput, dateInputToMs } from '../lib/format'
import { ADJUST_REASONS, type MovementType, type StockMovement } from '../types'

const TYPE_LABEL: Record<MovementType, string> = {
  receive: 'รับเข้า',
  issue: 'เบิก/โอน',
  adjust: 'ปรับ',
  consume: 'เบิกใช้',
}
const TYPE_COLOR: Record<MovementType, 'green' | 'blue' | 'amber' | 'red'> = {
  receive: 'green',
  issue: 'blue',
  adjust: 'amber',
  consume: 'red',
}

export function MovementsPage() {
  const { movements, locations, products, locationById } = useData()
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const isAdmin = user?.role === 'admin'

  const [productId, setProductId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [fromStr, setFromStr] = useState('')
  const [toStr, setToStr] = useState('')
  const [editing, setEditing] = useState<StockMovement | null>(null)
  const [photoDoc, setPhotoDoc] = useState<string | null>(null)

  const stockCardMode = !!productId && !!locationId

  const filtered = useMemo(() => {
    const fromMs = fromStr ? dateInputToMs(fromStr) : -Infinity
    const toMs = toStr ? dateInputToMs(toStr) + 86_400_000 : Infinity
    return movements
      .filter((m) => (productId ? m.productId === productId : true))
      .filter((m) =>
        locationId ? m.fromLocationId === locationId || m.toLocationId === locationId : true,
      )
      .filter((m) => (typeFilter ? m.type === typeFilter : true))
      .filter((m) => m.date >= fromMs && m.date <= toMs)
      .sort((a, b) => b.date - a.date || b.createdAt - a.createdAt)
  }, [movements, productId, locationId, typeFilter, fromStr, toStr])

  // running balance for stock-card mode (product + location)
  const balances = useMemo(() => {
    if (!stockCardMode) return new Map<string, number>()
    const asc = [...filtered].sort((a, b) => a.date - b.date || a.createdAt - b.createdAt)
    const map = new Map<string, number>()
    let bal = 0
    for (const m of asc) {
      if (!m.voided) bal += effectAt(m, locationId)
      map.set(m.id, bal)
    }
    return map
  }, [filtered, stockCardMode, locationId])

  async function doVoid(m: StockMovement) {
    const ok = await confirm({
      title: 'ยกเลิกรายการ',
      message: `ยกเลิกรายการ ${m.docNo} (${m.productName})? ระบบจะคืนยอดสต๊อกกลับ`,
      danger: true,
      confirmText: 'ยกเลิกรายการ',
    })
    if (!ok) return
    try {
      await voidMovement(m.id, { id: user!.id, name: user!.name })
      toast.success('ยกเลิกรายการแล้ว (คืนสต๊อก)')
    } catch (e) {
      toast.error('ทำรายการไม่สำเร็จ: ' + (e as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">📜 ประวัติ / Stock Card</h1>
        <p className="text-sm text-slate-500">
          ทุกการเคลื่อนไหวถูกบันทึกถาวร — เลือกสินค้า + คลัง เพื่อดูยอดคงเหลือแบบ Stock Card
        </p>
      </div>

      <Card className="p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="สินค้า">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">ทุกสินค้า</option>
              {[...products]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="คลัง/สาขา">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">ทุกคลัง</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ประเภท">
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">ทั้งหมด</option>
              <option value="receive">รับเข้า</option>
              <option value="issue">เบิก/โอน</option>
              <option value="consume">เบิกใช้</option>
              <option value="adjust">ปรับ</option>
            </Select>
          </Field>
          <Field label="ตั้งแต่วันที่">
            <Input type="date" value={fromStr} onChange={(e) => setFromStr(e.target.value)} />
          </Field>
          <Field label="ถึงวันที่">
            <Input type="date" value={toStr} onChange={(e) => setToStr(e.target.value)} />
          </Field>
        </div>
        {stockCardMode && (
          <p className="mt-2 text-xs text-emerald-700">
            📗 โหมด Stock Card: แสดงยอดคงเหลือสะสมของสินค้านี้ที่คลังที่เลือก
          </p>
        )}
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon="📜" title="ไม่พบรายการ" hint="ลองปรับตัวกรอง" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-240px)]">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs uppercase text-slate-500 shadow-sm">
                <tr>
                  <th className="px-3 py-2">วันที่</th>
                  <th className="px-3 py-2">เลขที่</th>
                  <th className="px-3 py-2">ประเภท</th>
                  <th className="px-3 py-2">สินค้า</th>
                  <th className="px-3 py-2">คลัง</th>
                  <th className="px-3 py-2 text-right">จำนวน</th>
                  {stockCardMode && <th className="px-3 py-2 text-right">คงเหลือ</th>}
                  <th className="px-3 py-2">โดย</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((m) => {
                  const eff = locationId ? effectAt(m, locationId) : signedByType(m)
                  return (
                    <tr key={m.id} className={m.voided ? 'bg-slate-50 text-slate-400' : ''}>
                      <td className="whitespace-nowrap px-3 py-2">{formatThaiDate(m.date)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{m.docNo}</td>
                      <td className="px-3 py-2">
                        <Badge color={TYPE_COLOR[m.type]}>{TYPE_LABEL[m.type]}</Badge>
                        {m.voided && <span className="ml-1 text-xs">(ยกเลิก)</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 font-medium text-slate-700">
                          {m.productName}
                          {m.hasPhoto && (
                            <button
                              onClick={() => setPhotoDoc(m.docNo)}
                              title="ดูรูปหลักฐาน"
                              className="text-sm"
                            >
                              📷
                            </button>
                          )}
                        </div>
                        {m.reason && (
                          <div className="text-xs text-slate-400">
                            {ADJUST_REASONS.find((r) => r.value === m.reason)?.label ?? m.reason}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {m.fromLocationId && locationById(m.fromLocationId)?.name}
                        {m.fromLocationId && m.toLocationId && ' → '}
                        {m.toLocationId && locationById(m.toLocationId)?.name}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${
                          eff < 0 ? 'text-rose-600' : 'text-emerald-700'
                        }`}
                      >
                        {eff > 0 ? '+' : ''}
                        {fmtQty(eff)} {m.unit}
                      </td>
                      {stockCardMode && (
                        <td className="px-3 py-2 text-right font-semibold text-slate-800">
                          {fmtQty(balances.get(m.id) ?? 0)}
                        </td>
                      )}
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {m.byUserName}
                        {m.updatedByName && <div className="text-amber-600">แก้ไข: {m.updatedByName}</div>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!m.voided && (
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" onClick={() => setEditing(m)}>
                              แก้ไข
                            </Button>
                            {isAdmin && (
                              <button
                                onClick={() => doVoid(m)}
                                className="rounded px-2 text-xs text-rose-600 hover:bg-rose-50"
                              >
                                ยกเลิก
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing && (
        <EditMovementModal movement={editing} onClose={() => setEditing(null)} />
      )}
      {photoDoc && <PhotoModal docNo={photoDoc} onClose={() => setPhotoDoc(null)} />}
    </div>
  )
}

function PhotoModal({ docNo, onClose }: { docNo: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let on = true
    getMovementImage(docNo).then((u) => {
      if (!on) return
      setUrl(u)
      setLoading(false)
    })
    return () => {
      on = false
    }
  }, [docNo])
  return (
    <Modal open onClose={onClose} title={`รูปหลักฐาน — ${docNo}`}>
      {loading ? (
        <div className="p-6 text-center text-sm text-slate-400">กำลังโหลด...</div>
      ) : url ? (
        <img src={url} alt="หลักฐาน" className="mx-auto max-h-[70vh] rounded-lg" />
      ) : (
        <div className="p-6 text-center text-sm text-slate-400">ไม่พบรูป</div>
      )}
    </Modal>
  )
}

function EditMovementModal({
  movement,
  onClose,
}: {
  movement: StockMovement
  onClose: () => void
}) {
  const { user } = useAuth()
  const toast = useToast()
  const [qty, setQty] = useState(movement.qty)
  const [dateStr, setDateStr] = useState(msToDateInput(movement.date))
  const [note, setNote] = useState(movement.note ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!(qty > 0)) return toast.error('จำนวนต้องมากกว่า 0')
    setBusy(true)
    try {
      await editMovementQty({
        movementId: movement.id,
        newQty: qty,
        newDate: dateInputToMs(dateStr),
        newNote: note,
        actor: { id: user!.id, name: user!.name },
      })
      toast.success('แก้ไขรายการแล้ว (ปรับยอดสต๊อกให้อัตโนมัติ)')
      onClose()
    } catch (e) {
      toast.error('แก้ไขไม่สำเร็จ: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`แก้ไขรายการ ${movement.docNo}`}>
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="font-medium">{movement.productName}</span>
          <span className="text-slate-500"> — {TYPE_LABEL[movement.type]}</span>
        </div>
        <Field label="จำนวน" required>
          <Input
            type="number"
            step="any"
            min={0}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
        </Field>
        <Field label="วันที่">
          <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
        </Field>
        <Field label="หมายเหตุ">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Effect of a movement on a specific location's balance. */
function effectAt(m: StockMovement, locationId: string): number {
  if (m.toLocationId === locationId) return m.qty
  if (m.fromLocationId === locationId) return -m.qty
  return 0
}

/** Signed quantity by type when no location is selected (receive +, issue/adjust-out −). */
function signedByType(m: StockMovement): number {
  if (m.type === 'receive') return m.qty
  if (m.toLocationId && !m.fromLocationId) return m.qty // adjust-in
  return -m.qty
}
