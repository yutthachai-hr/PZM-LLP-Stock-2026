import { useRef, useState } from 'react'
import { Button, Modal, Textarea } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'

/**
 * One question, one text box: why. Used for return / reject / remove / reopen / approve-note,
 * and for cancelling a stock movement.
 *
 * The modal stays open with the text intact when `onConfirm` throws, so a failed save never
 * loses what was typed; the caller closes it on success. A second tap while the first is saving
 * is ignored even before React re-renders the disabled button.
 */
export function ReasonModal({
  title,
  message,
  confirmText,
  required = true,
  danger = false,
  maxLength,
  onClose,
  onConfirm,
}: {
  title: string
  message?: string
  confirmText: string
  required?: boolean
  danger?: boolean
  /** Longest reason accepted (after trimming); shows a counter. */
  maxLength?: number
  onClose: () => void
  onConfirm: (reason: string) => Promise<void> | void
}) {
  const t = useT()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const length = reason.trim().length
  const tooLong = maxLength !== undefined && length > maxLength
  const ok = (!required || length > 0) && !tooLong
  return (
    <Modal open onClose={busy ? () => {} : onClose} title={title}>
      <div className="space-y-3">
        {message && <p className="text-sm text-ink-soft">{message}</p>}
        <Textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={required ? t('เหตุผล (จำเป็น)') : t('หมายเหตุ (ไม่บังคับ)')}
          aria-invalid={tooLong || undefined}
          autoFocus
        />
        {maxLength !== undefined && (
          <p className={`text-right text-xs ${tooLong ? 'text-danger' : 'text-ink-faint'}`} aria-live="polite">
            {length}/{maxLength}
          </p>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('ยกเลิก')}
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          disabled={busy || !ok}
          onClick={async () => {
            if (inFlight.current || !ok) return
            inFlight.current = true
            setBusy(true)
            try {
              await onConfirm(reason.trim())
            } finally {
              inFlight.current = false
              setBusy(false)
            }
          }}
        >
          {busy ? t('กำลังบันทึก...') : confirmText}
        </Button>
      </div>
    </Modal>
  )
}
