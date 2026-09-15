import { useState } from 'react'
import { Button, Modal, Textarea } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'

/** One question, one text box: why. Used for return / reject / remove / reopen / approve-note. */
export function ReasonModal({
  title,
  message,
  confirmText,
  required = true,
  danger = false,
  onClose,
  onConfirm,
}: {
  title: string
  message?: string
  confirmText: string
  required?: boolean
  danger?: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<void> | void
}) {
  const t = useT()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = !required || reason.trim().length > 0
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-3">
        {message && <p className="text-sm text-ink-soft">{message}</p>}
        <Textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={required ? t('เหตุผล (จำเป็น)') : t('หมายเหตุ (ไม่บังคับ)')}
          autoFocus
        />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('ยกเลิก')}
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          disabled={busy || !ok}
          onClick={async () => {
            setBusy(true)
            try {
              await onConfirm(reason.trim())
            } finally {
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
