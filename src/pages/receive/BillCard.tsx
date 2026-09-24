import { useEffect, useRef } from 'react'
import { SectionCard } from '../../components/frame'
import { Field, Textarea } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { LineBuilder } from '../../components/LineBuilder'
import { useConfirm } from '../../components/Confirm'
import { useT } from '../../i18n/I18nContext'
import type { Product } from '../../types'
import type { Bill } from './bills'

/**
 * One supplier's delivery note: its number, then what was on it.
 *
 * Laid out the way the paper arrives — pick up the next bill, type its number once, key its
 * lines under it — so nobody retypes a bill number on every line (owner's choice between
 * the two layouts, 24 Sep 2026).
 */
export function BillCard({
  index,
  bill,
  onChange,
  onRemove,
  focusNote,
  products,
  onHandAt,
}: {
  index: number
  bill: Bill
  onChange: (next: Bill) => void
  /** Absent when this is the only card: there is always one to key into. */
  onRemove?: () => void
  /** Bump to put the cursor in this card's bill number — a new card, or after a save. */
  focusNote?: number
  products: Product[]
  onHandAt?: (productId: string) => number
}) {
  const t = useT()
  const confirm = useConfirm()
  const noteBox = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (focusNote) noteBox.current?.focus()
  }, [focusNote])

  async function remove() {
    if (!onRemove) return
    if (bill.lines.length > 0) {
      const ok = await confirm({
        title: t('ลบบิล'),
        message: t('ลบบิล {n} พร้อม {count} รายการในบิลนี้? (ยังไม่ได้บันทึก จึงไม่กระทบสต๊อก)', { n: index + 1, count: bill.lines.length }),
        confirmText: t('ลบบิล'),
        danger: true,
      })
      if (!ok) return
    }
    onRemove()
  }

  return (
    <SectionCard
      icon="note"
      title={t('บิล {n}', { n: index + 1 })}
      count={bill.lines.length ? t('({n} รายการ)', { n: bill.lines.length }) : undefined}
      actions={
        onRemove ? (
          <button
            type="button"
            onClick={() => void remove()}
            aria-label={t('ลบบิล {n}', { n: index + 1 })}
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-ink-faint outline-none transition-colors duration-150 hover:bg-danger-soft hover:text-danger focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Icon name="trash" size={18} />
          </button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <Field
          label={t('หมายเหตุ / เลขบิลส่งของ (Supplier)')}
          required
          hint={t('ระบุเลขเอกสารจริงจาก Supplier — เช่น เดล ตาซาโร (ประเทศไทย) จำกัด · Bocconcini 4.5 kg · เลขบิล IV2616876')}
        >
          <Textarea
            ref={noteBox}
            rows={2}
            value={bill.note}
            onChange={(e) => onChange({ ...bill, note: e.target.value })}
            placeholder={t('เช่น เดล ตาซาโร (ประเทศไทย) จำกัด / เลขบิล IV2616876')}
          />
        </Field>
        <LineBuilder
          products={products}
          lines={bill.lines}
          onChange={(lines) => onChange({ ...bill, lines })}
          direction="in"
          onHandAt={onHandAt}
          lineNotes
        />
      </div>
    </SectionCard>
  )
}
