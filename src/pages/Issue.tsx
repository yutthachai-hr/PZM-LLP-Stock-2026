import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Button, Card, Field, FormActions, Input, PageHeader, Select, Textarea } from '../components/ui'
import { LineBuilder, type Line } from '../components/LineBuilder'
import { issueStock, consumeStock } from '../services/stock'
import { compressImage } from '../lib/image'
import { dateInputToMs, msToDateInput, todayMs } from '../lib/format'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'

type Mode = 'transfer' | 'consume'

export function IssuePage() {
  const t = useT()
  const [mode, setMode] = useState<Mode>('transfer')

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        icon="truck"
        tone="out"
        title={t("เบิก / โอน / ตัดออก")}
        subtitle={t("โอนของไปเก็บที่สาขา หรือเบิกของออกจากคลังไปใช้/ขายหน้าร้าน — ตัดสต๊อกอัตโนมัติ")}
      />

      <div className="flex gap-1 rounded-lg bg-sunken p-1">
        <Tab label={t("โอนไปสาขา (เก็บสต๊อก)")} active={mode === 'transfer'} onClick={() => setMode('transfer')} />
        <Tab label={t("เบิกใช้ / ตัดออก (หน้าร้าน)")} active={mode === 'consume'} onClick={() => setMode('consume')} />
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
  const t = useT()
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
    if (!fromLocationId || !toLocationId) return toast.error(t("เลือกต้นทางและปลายทาง"))
    if (fromLocationId === toLocationId) return toast.error(t("ต้นทางและปลายทางต้องต่างกัน"))
    if (lines.length === 0) return toast.error(t("เพิ่มรายการสินค้าก่อน"))
    if (lines.some((l) => !(l.qty > 0))) return toast.error(t("จำนวนต้องมากกว่า 0"))
    const over = lines.find((l) => l.qty > availableAt(l.productId))
    if (over) return toast.error(t('สต๊อกไม่พอสำหรับ "{name}"', { name: over.productName }))

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
      toast.success(t('เบิก/โอนเรียบร้อย (เลขที่ {docNo})', { docNo }))
      setLines([])
      setNote('')
    } catch (e) {
      toast.error(t("บันทึกไม่สำเร็จ:") + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("จากคลัง (ต้นทาง)")} required>
          <Select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
            {active.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("ไปยังสาขา (ปลายทาง)")} required>
          <Select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
            <option value="">{t("— เลือก —")}</option>
            {active
              .filter((l) => l.id !== fromLocationId)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t("วันที่เบิก")} required>
          <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
        </Field>
        <Field label={t("ผู้เบิก (บันทึกอัตโนมัติ)")}>
          <Input value={user?.name ?? ''} disabled />
        </Field>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">{t("รายการสินค้า")}</div>
        <LineBuilder
          products={products}
          lines={lines}
          onChange={setLines}
          availableAt={availableAt}
          direction="out"
        />
      </div>

      <Field label={t("หมายเหตุ (ไม่บังคับ)")}>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <FormActions>
        <Button onClick={submit} disabled={busy || lines.length === 0}>
          {busy ? t("กำลังบันทึก...") : t('บันทึกโอนไปสาขา ({n} รายการ)', { n: lines.length })}
        </Button>
      </FormActions>
    </Card>
  )
}

// ------------------------------------------------------------------ Consume
function ConsumeForm() {
  const t = useT()
  const { products, locations, qtyAt } = useData()
  const { user } = useAuth()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const active = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  const defaultFrom = active.find((l) => l.type === 'warehouse') ?? active[0]

  const [fromLocationId, setFromLocationId] = useState('')
  const [dateStr, setDateStr] = useState(msToDateInput(todayMs()))
  const [note, setNote] = useState('สุขุมวิท') // prefilled note saved as data, user-editable — i18n-key
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
      toast.error(t("อ่านรูปไม่สำเร็จ"))
    }
  }

  async function submit() {
    if (!fromLocationId) return toast.error(t("เลือกคลังต้นทาง"))
    if (lines.length === 0) return toast.error(t("เพิ่มรายการสินค้าก่อน"))
    if (lines.some((l) => !(l.qty > 0))) return toast.error(t("จำนวนต้องมากกว่า 0"))
    const over = lines.find((l) => l.qty > availableAt(l.productId))
    if (over) return toast.error(t('สต๊อกไม่พอสำหรับ "{name}"', { name: over.productName }))

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
      toast.success(t('บันทึกเบิกใช้เรียบร้อย (เลขที่ {docNo})', { docNo }))
      setLines([])
      setPhoto(null)
    } catch (e) {
      toast.error(t("บันทึกไม่สำเร็จ:") + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {t("เบิกของออกจากคลังไปใช้/ขายหน้าร้าน (เช่น สาขาสุขุมวิทที่อยู่ที่เดียวกับคลัง) — ตัดสต๊อกออก ไม่เพิ่มเข้าสาขาอื่น")}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("เบิกจากคลัง")} required>
          <Select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
            {active.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("วันที่เบิก")} required>
          <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
        </Field>
        <Field label={t("ผู้เบิก (บันทึกอัตโนมัติ)")}>
          <Input value={user?.name ?? ''} disabled />
        </Field>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">{t("รายการสินค้าที่เบิก")}</div>
        <LineBuilder
          products={products}
          lines={lines}
          onChange={setLines}
          availableAt={availableAt}
          direction="out"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("เบิกไปใช้ที่ / หมายเหตุ")}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("เช่น สุขุมวิท")} />
        </Field>
        <Field label={t("รูปหลักฐาน (แนบได้ทุกครั้ง)")}>
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
                alt={t('หลักฐาน')}
                className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-300">
                <Icon name="camera" size={18} />
              </div>
            )}
            <div className="space-y-1">
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                <Icon name="camera" size={16} />
            {t("ถ่าย / เลือกรูป")}
              </Button>
              {photo && (
                <button
                  onClick={() => setPhoto(null)}
                  className="block text-xs text-rose-500 hover:underline"
                >
                  {t("ลบรูป")}
                </button>
              )}
            </div>
          </div>
        </Field>
      </div>

      <FormActions>
        <Button onClick={submit} disabled={busy || lines.length === 0} variant="danger">
          {busy ? t("กำลังบันทึก...") : t('บันทึกเบิกใช้ ({n} รายการ)', { n: lines.length })}
        </Button>
      </FormActions>
    </Card>
  )
}
