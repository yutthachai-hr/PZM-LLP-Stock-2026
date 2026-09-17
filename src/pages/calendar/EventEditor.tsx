import { useState } from 'react'
import { useToast } from '../../components/Toast'
import { Button, Field, Input, Modal, Select, Textarea } from '../../components/ui'
import { useData } from '../../data/DataContext'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { assigneesOf, createEvent, updateEvent, type EventInput } from '../../services/events'
import type { StockEvent, StockEventPriority, StockEventType } from '../../types'
import { PRIORITY_LABEL, TASK_TYPES, TYPE_LABEL } from './chips'

export function toDateInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function toTimeInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fromInputs(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = (time || '09:00').split(':').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 9, mm ?? 0).getTime()
}

/** The form for a task: create, or change one. Only the types this calendar still offers. */
export function EventEditor({
  event,
  initialStart,
  userId,
  onClose,
  onSaved,
}: {
  event: StockEvent | null
  /** For a new task opened from a day: that day, at the current time of day. */
  initialStart?: number
  userId: string
  onClose: () => void
  onSaved: (saved: StockEvent) => void
}) {
  const t = useT()
  const toast = useToast()
  const { locations, users } = useData()
  const start =
    event?.startAt ?? (initialStart !== undefined ? fromInputs(toDateInput(initialStart), toTimeInput(Date.now())) : Date.now())

  const [title, setTitle] = useState(event?.title ?? '')
  const [type, setType] = useState<StockEventType>(event?.type ?? 'stockCount')
  const [locationId, setLocationId] = useState(event?.locationId ?? '')
  const [date, setDate] = useState(toDateInput(start))
  const [time, setTime] = useState(toTimeInput(start))
  const [dueDate, setDueDate] = useState(event?.dueAt ? toDateInput(event.dueAt) : '')
  const [priority, setPriority] = useState<StockEventPriority>(event?.priority ?? 'normal')
  // One person, several, or everyone — the owner's three cases. Everyone is its own flag,
  // and choosing it clears the list, so an event is never "everyone, and also these two".
  const [assignedTo, setAssignedTo] = useState<string[]>(() => (event ? assigneesOf(event) : []))
  const [assignedToAll, setAssignedToAll] = useState(!!event?.assignedToAll)
  function toggleAssignee(id: string) {
    setAssignedTo((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }
  const [note, setNote] = useState(event?.note ?? '')
  const [busy, setBusy] = useState(false)
  // A type this calendar no longer offers stays on an old task; the list adds it so the
  // select is not blank.
  const types = TASK_TYPES.includes(type) ? TASK_TYPES : [...TASK_TYPES, type]

  async function save() {
    if (!title.trim()) return toast.error(t('กรุณาใส่ชื่องาน'))
    setBusy(true)
    try {
      const input: EventInput = {
        title: title.trim(),
        type,
        locationId: locationId || undefined,
        startAt: fromInputs(date, time),
        dueAt: dueDate ? fromInputs(dueDate, '23:59') : undefined,
        priority,
        assignedTo: assignedToAll ? undefined : assignedTo,
        assignedToAll: assignedToAll || undefined,
        // Stored so a staff member holding a uid does not have to read `users` to show it.
        assignedToName: assignedToAll
          ? t('ทุกคน')
          : assignedTo
              .map((id) => users.find((u) => u.id === id)?.name)
              .filter((n): n is string => !!n)
              .join(', ') || undefined,
        note,
      }
      const now = Date.now()
      if (event) {
        await updateEvent(event.id, input)
        onSaved({ ...event, ...input, updatedAt: now } as StockEvent)
      } else {
        const id = await createEvent(input, userId)
        onSaved({ id, ...input, status: 'upcoming', createdBy: userId, createdAt: now, updatedAt: now } as StockEvent)
      }
      toast.success(t('บันทึกแล้ว'))
      onClose()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={event ? t('แก้ไขงาน') : t('เพิ่มงาน')}>
      <div className="space-y-3">
        <Field label={t('ชื่องาน')} required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('เช่น นับสต๊อกคลังหลัก')} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ประเภท')}>
            <Select value={type} onChange={(e) => setType(e.target.value as StockEventType)}>
              {types.map((k) => (
                <option key={k} value={k}>
                  {t(TYPE_LABEL[k])}
                </option>
              ))}
            </Select>
          </Field>
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('วันที่')} required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('เวลา')}>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label={t('กำหนดเสร็จ (ไม่บังคับ)')}>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label={t('คลัง/สาขา')}>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t('ไม่ระบุ')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
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
            {users
              .filter((u) => u.active !== false)
              .map((u) => (
                <label
                  key={u.id}
                  className={`flex min-h-11 items-center gap-3 px-3 text-sm ${
                    assignedToAll ? 'cursor-default text-ink-faint' : 'cursor-pointer text-ink hover:bg-sunken'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={assignedToAll || assignedTo.includes(u.id)}
                    disabled={assignedToAll}
                    onChange={() => toggleAssignee(u.id)}
                    className="h-4 w-4 accent-brand"
                  />
                  {u.name}
                </label>
              ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-soft">
            {assignedToAll ? t('มอบหมายให้ทุกคน') : assignedTo.length === 0 ? t('ยังไม่มอบหมาย') : t('มอบหมาย {n} คน', { n: assignedTo.length })}
          </p>
        </fieldset>
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
