import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useConfirm } from '../../components/Confirm'
import { Icon } from '../../components/Icon'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, Field, Input, Modal, rowAction, SectionHeader, Select, Textarea } from '../../components/ui'
import { useData } from '../../data/DataContext'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { formatThaiDateShort } from '../../lib/format'
import { occurrencesBetween } from '../../lib/inventoryRules/schedules'
import { bkkDayStart, DAY_MS } from '../../lib/inventoryRules/time'
import {
  createSchedule,
  deleteSchedule,
  updateSchedule,
  useScheduleConfig,
  type ScheduleInput,
} from '../../services/schedules'
import type { InventorySchedule, ScheduleFrequency, StockEventPriority } from '../../types'
import { DAY_NAMES, PRIORITY_LABEL } from '../calendar/chips'
import { fromInputs, toDateInput } from '../calendar/EventEditor'

const FREQ_LABEL: Record<ScheduleFrequency, string> = {
  daily: 'ทุกวัน', // i18n-key
  weekly: 'ทุกสัปดาห์', // i18n-key
  biweekly: 'ทุก 2 สัปดาห์', // i18n-key
  monthly: 'ทุกเดือน', // i18n-key
  custom: 'ทุก ๆ กี่วัน', // i18n-key
}
const FREQS: ScheduleFrequency[] = ['daily', 'weekly', 'biweekly', 'monthly', 'custom']

/**
 * Recurring stock counts. Each schedule turns into ordinary tasks on the calendar, two
 * weeks ahead, one per occurrence — written by the nightly job (or by the calendar when
 * the job is late). Editing a schedule changes the days not yet written; tasks already on
 * the calendar stay as they are and are moved or cancelled there.
 */
export function SchedulesSection() {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const { locationById } = useData()
  const { schedules, loaded } = useScheduleConfig()
  const [editing, setEditing] = useState<InventorySchedule | null>(null)
  const [adding, setAdding] = useState(false)

  async function remove(s: InventorySchedule) {
    const ok = await confirm({
      title: t('ลบตารางนับ'),
      message: t('ลบ "{name}" ? งานที่สร้างไว้แล้วในปฏิทินยังอยู่ (ยกเลิกทีละงานได้ในปฏิทิน)', { name: s.name }),
      danger: true,
      confirmText: t('ลบ'),
    })
    if (!ok) return
    try {
      await deleteSchedule(s.id)
      toast.success(t('ลบแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  return (
    <Card className="p-4">
      <SectionHeader
        icon="calendar"
        title={t('ตารางนับสต๊อก')}
        description={t('ระบบสร้างงานนับสต๊อกลงปฏิทินล่วงหน้า 14 วันตามตารางนี้ ไม่สร้างซ้ำ')}
        actions={
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />
            {t('เพิ่มตาราง')}
          </Button>
        }
      />
      {!loaded ? (
        <p className="py-2 text-sm text-ink-faint">{t('กำลังโหลด...')}</p>
      ) : schedules.length === 0 ? (
        <p className="py-2 text-sm text-ink-soft">{t('ยังไม่มีตารางนับสต๊อก')}</p>
      ) : (
        <div className="divide-y divide-line">
          {schedules.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{s.name}</span>
                  {!s.enabled && <Badge color="slate">{t('ปิดอยู่')}</Badge>}
                  {s.requiresApproval && <Badge color="amber">{t('ต้องอนุมัติ')}</Badge>}
                </div>
                <div className="text-xs text-ink-soft">
                  {locationById(s.locationId)?.name ?? s.locationId} · {rhythm(s, t)} · {s.startTime}
                  {s.assignedToName ? ` · ${s.assignedToName}` : ''}
                </div>
              </div>
              <button onClick={() => setEditing(s)} className={`${rowAction} text-ink-soft hover:bg-sunken hover:text-ink`}>
                {t('แก้ไข')}
              </button>
              <button onClick={() => void remove(s)} className={`${rowAction} font-medium text-danger hover:bg-danger-soft`}>
                {t('ลบ')}
              </button>
            </div>
          ))}
        </div>
      )}
      {(adding || editing) && (
        <ScheduleEditor
          schedule={editing}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
        />
      )}
    </Card>
  )
}

function rhythm(s: InventorySchedule, t: (k: string, p?: Record<string, string | number>) => string): string {
  const days = (s.daysOfWeek ?? []).map((d) => t(DAY_NAMES[d])).join(' ')
  switch (s.frequency) {
    case 'daily':
      return t('ทุกวัน')
    case 'weekly':
      return t('ทุกสัปดาห์ ({days})', { days })
    case 'biweekly':
      return t('ทุก 2 สัปดาห์ ({days})', { days })
    case 'monthly':
      return t('ทุกเดือน วันที่ {n}', { n: s.dayOfMonth ?? 1 })
    case 'custom':
      return t('ทุก {n} วัน', { n: s.intervalDays ?? 1 })
  }
}

function ScheduleEditor({ schedule, onClose }: { schedule: InventorySchedule | null; onClose: () => void }) {
  const t = useT()
  const toast = useToast()
  const { locations, users } = useData()
  const { user } = useAuth()
  const [name, setName] = useState(schedule?.name ?? '')
  const [locationId, setLocationId] = useState(schedule?.locationId ?? locations[0]?.id ?? '')
  const [frequency, setFrequency] = useState<ScheduleFrequency>(schedule?.frequency ?? 'weekly')
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(schedule?.daysOfWeek ?? [1])
  const [dayOfMonth, setDayOfMonth] = useState(String(schedule?.dayOfMonth ?? 1))
  const [intervalDays, setIntervalDays] = useState(String(schedule?.intervalDays ?? 7))
  const [anchor, setAnchor] = useState(toDateInput(schedule?.anchorDay ?? Date.now()))
  const [startTime, setStartTime] = useState(schedule?.startTime ?? '09:00')
  const [durationH, setDurationH] = useState(schedule?.durationMin ? String(schedule.durationMin / 60) : '')
  const [assignedToAll, setAssignedToAll] = useState(schedule ? !!schedule.assignedToAll : true)
  const [assignedTo, setAssignedTo] = useState<string[]>(schedule?.assignedTo ?? [])
  const [requiresApproval, setRequiresApproval] = useState(!!schedule?.requiresApproval)
  const [priority, setPriority] = useState<StockEventPriority>(schedule?.priority ?? 'normal')
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true)
  const [note, setNote] = useState(schedule?.note ?? '')
  const [busy, setBusy] = useState(false)
  const active = users.filter((u) => u.active !== false)

  const input: ScheduleInput = {
    name,
    locationId,
    frequency,
    daysOfWeek,
    dayOfMonth: Number(dayOfMonth),
    intervalDays: Number(intervalDays),
    // Biweekly and every-N-days count from a day; the others do not need one.
    anchorDay: frequency === 'biweekly' || frequency === 'custom' ? bkkDayStart(fromInputs(anchor, '12:00')) : undefined,
    startTime,
    durationMin: durationH ? Math.round(Number(durationH) * 60) : undefined,
    assignedToAll,
    assignedTo: assignedToAll ? undefined : assignedTo,
    assignedToName: assignedToAll
      ? t('ทุกคน')
      : assignedTo.map((id) => active.find((u) => u.id === id)?.name).filter((n): n is string => !!n).join(', ') || undefined,
    requiresApproval,
    priority,
    enabled: true,
    note,
  }

  // The next five days it falls on, from the same function the job runs.
  const preview = useMemo(() => {
    const now = Date.now()
    const probe = { ...input, enabled: true, id: 'preview', kind: 'stockCount', createdBy: '', createdAt: now, updatedAt: now } as InventorySchedule
    try {
      return occurrencesBetween(probe, now, now + 120 * DAY_MS).slice(0, 5)
    } catch {
      return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency, daysOfWeek, dayOfMonth, intervalDays, anchor])

  function toggleDay(d: number) {
    setDaysOfWeek((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))
  }

  async function save() {
    setBusy(true)
    try {
      const full = { ...input, enabled }
      if (schedule) await updateSchedule(schedule.id, full)
      else await createSchedule(full, { id: user!.id })
      toast.success(t('บันทึกแล้ว'))
      onClose()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={schedule ? t('แก้ไขตารางนับ') : t('เพิ่มตารางนับ')}>
      <div className="space-y-3">
        <Field label={t('ชื่อ')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('เช่น นับสต๊อกคลังหลักประจำสัปดาห์')} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('คลัง/สาขา')} required>
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('ความถี่')}>
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)}>
              {FREQS.map((f) => (
                <option key={f} value={f}>
                  {t(FREQ_LABEL[f])}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {(frequency === 'weekly' || frequency === 'biweekly') && (
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-ink">{t('วันในสัปดาห์')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {DAY_NAMES.map((label, d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={daysOfWeek.includes(d)}
                  onClick={() => toggleDay(d)}
                  className={`min-h-11 min-w-11 cursor-pointer rounded-lg border px-2 text-sm ${
                    daysOfWeek.includes(d) ? 'border-brand bg-brand-soft font-semibold text-brand' : 'border-line-strong text-ink-soft hover:bg-sunken'
                  }`}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {frequency === 'monthly' && (
          <Field label={t('วันที่ของเดือน')} hint={t('เดือนที่ไม่มีวันนั้น จะนับวันสุดท้ายของเดือนแทน')}>
            <Input type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
          </Field>
        )}
        {frequency === 'custom' && (
          <Field label={t('ทุกกี่วัน')}>
            <Input type="number" min={1} max={365} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
          </Field>
        )}
        {(frequency === 'biweekly' || frequency === 'custom') && (
          <Field label={t('เริ่มนับจากวันที่')}>
            <Input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('เวลาเริ่ม')}>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label={t('ต้องเสร็จภายใน (ชั่วโมง)')} hint={t('เว้นว่าง = ภายในวันนั้น')}>
            <Input type="number" min={0} step={0.5} value={durationH} onChange={(e) => setDurationH(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-ink-soft">
          {preview.length > 0
            ? t('ครั้งถัดไป: {dates}', { dates: preview.map((d) => formatThaiDateShort(d)).join(', ') })
            : t('ยังไม่มีวันที่ตรงกับตารางนี้')}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ความสำคัญ')}>
            <Select value={priority} onChange={(e) => setPriority(e.target.value as StockEventPriority)}>
              {(['normal', 'high', 'critical'] as StockEventPriority[]).map((k) => (
                <option key={k} value={k}>
                  {t(PRIORITY_LABEL[k])}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 block text-sm font-medium text-ink">{t('ผู้รับผิดชอบ')}</legend>
          <div className="max-h-48 divide-y divide-line overflow-auto rounded-lg border border-line-strong">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm font-medium text-ink hover:bg-sunken">
              <input
                type="checkbox"
                checked={assignedToAll}
                onChange={(e) => {
                  setAssignedToAll(e.target.checked)
                  if (e.target.checked) setAssignedTo([])
                }}
                className="h-4 w-4 accent-brand"
              />
              {t('ทุกคน')}
            </label>
            {active.map((u) => (
              <label key={u.id} className={`flex min-h-11 items-center gap-3 px-3 text-sm ${assignedToAll ? 'text-ink-faint' : 'cursor-pointer text-ink hover:bg-sunken'}`}>
                <input
                  type="checkbox"
                  checked={assignedToAll || assignedTo.includes(u.id)}
                  disabled={assignedToAll}
                  onChange={() => setAssignedTo((cur) => (cur.includes(u.id) ? cur.filter((x) => x !== u.id) : [...cur, u.id]))}
                  className="h-4 w-4 accent-brand"
                />
                {u.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
          <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} className="h-4 w-4 accent-brand" />
          {t('ต้องให้หัวหน้าอนุมัติเมื่อเสร็จ')}
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-brand" />
          {t('เปิดใช้ตารางนี้')}
        </label>
        <Field label={t('หมายเหตุ')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('ยกเลิก')}
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? t('กำลังบันทึก...') : t('บันทึก')}
        </Button>
      </div>
    </Modal>
  )
}
