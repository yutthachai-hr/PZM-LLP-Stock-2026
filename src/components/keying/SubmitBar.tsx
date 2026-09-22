import type { ReactNode } from 'react'
import { useT } from '../../i18n/I18nContext'
import { Icon } from '../Icon'

/**
 * The foot of a keying form (owner's mock-ups 03/04): the draft's state on the left, the
 * page's one commit button on the right.
 *
 * There is no "save draft" button to press: every keying form already keeps its half-keyed
 * lines on this device as they are typed (lib/useDraft), so the left side says that rather
 * than offering an action that does nothing. On a phone the bar sticks above the tab bar,
 * because these forms run longer than a screen once a few lines are on them.
 */
export function SubmitBar({ hasDraft, children }: { hasDraft: boolean; children: ReactNode }) {
  const t = useT()
  return (
    <div className="sticky -mx-4 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur [bottom:var(--tabbar-h)] md:static md:mx-0 md:rounded-2xl md:border md:bg-surface md:px-5 md:py-4 md:backdrop-filter-none">
      <span className={`hidden items-center gap-2 text-sm sm:flex ${hasDraft ? 'text-ink-soft' : 'text-ink-faint'}`}>
        <Icon name={hasDraft ? 'checkCircle' : 'note'} size={16} className={hasDraft ? 'text-in' : ''} />
        {hasDraft ? t('บันทึกร่างไว้ในเครื่องนี้แล้ว') : t('ร่างจะถูกเก็บไว้ในเครื่องนี้อัตโนมัติ')}
      </span>
      <div className="flex flex-1 justify-end gap-2 sm:flex-none">{children}</div>
    </div>
  )
}
