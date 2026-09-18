import { useState } from 'react'
import { Button, Field, Input, Modal, Textarea } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import type { StockEvent } from '../../types'
import { fromInputs, toDateInput, toTimeInput } from './EventEditor'

/**
 * Move a task to another day or time. The reason is required: it goes into the task's
 * history beside the old and new time, which is what the owner asked to see afterwards.
 */
export function RescheduleModal({
  event,
  onClose,
  onSubmit,
}: {
  event: StockEvent
  onClose: () => void
  onSubmit: (newStart: number, reason: string) => Promise<void>
}) {
  const t = useT()
  const [date, setDate] = useState(toDateInput(event.startAt))
  const [time, setTime] = useState(toTimeInput(event.startAt))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const next = date ? fromInputs(date, time) : event.startAt
  const unchanged = next === event.startAt

  async function submit() {
    setBusy(true)
    try {
      await onSubmit(next, reason)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('เลื่อนงาน')}>
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">{event.title}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('วันที่ใหม่')} required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('เวลา')}>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label={t('เหตุผลที่เลื่อน')} required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('ยกเลิก')}
        </Button>
        <Button onClick={submit} disabled={busy || unchanged || !reason.trim()}>
          {busy ? t('กำลังบันทึก...') : t('เลื่อนงาน')}
        </Button>
      </div>
    </Modal>
  )
}

/** One question, one reason: cancelling a task, or sending one back to be done again. */
export function ReasonModal({
  title,
  message,
  confirmText,
  required,
  danger,
  onClose,
  onSubmit,
}: {
  title: string
  message: string
  confirmText: string
  required: boolean
  danger?: boolean
  onClose: () => void
  onSubmit: (reason: string) => Promise<void>
}) {
  const t = useT()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      await onSubmit(reason)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <p className="mb-3 whitespace-pre-line text-sm text-ink-soft">{message}</p>
      <Field label={required ? t('เหตุผล') : t('เหตุผล (ไม่บังคับ)')} required={required}>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('ปิด')}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={submit} disabled={busy || (required && !reason.trim())}>
          {confirmText}
        </Button>
      </div>
    </Modal>
  )
}
