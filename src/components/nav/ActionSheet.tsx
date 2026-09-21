import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useT } from '../../i18n/I18nContext'
import { Icon } from '../Icon'
import { Modal } from '../ui'
import { actionsFor } from './navItems'

/**
 * What the "+" opens: the four things a person does with stock, one tap each. Reuses the
 * Modal in sheet mode so it has the same focus trap, Escape and backdrop as every dialog.
 */
export function ActionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const { user } = useAuth()
  return (
    <Modal open={open} onClose={onClose} title={t('ทำรายการ')} sheet>
      <div className="grid grid-cols-2 gap-3 p-4 [padding-bottom:calc(1rem+env(safe-area-inset-bottom))]">
        {actionsFor(user?.role).map((a) => (
          <button
            key={a.to}
            type="button"
            onClick={() => {
              onClose()
              navigate(a.to)
            }}
            className="flex min-h-24 cursor-pointer flex-col items-start justify-end gap-1 rounded-xl border border-line bg-surface p-3 text-left outline-none active:bg-brand-soft focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Icon name={a.icon} size={24} className="text-brand" />
            <span className="text-sm font-semibold text-ink">{t(a.label)}</span>
            <span className="text-xs text-ink-soft">{t(a.hint)}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
