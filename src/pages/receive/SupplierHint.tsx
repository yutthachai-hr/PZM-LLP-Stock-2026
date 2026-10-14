import { AlertBanner, Button } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useT } from '../../i18n/I18nContext'
import type { Candidate, Conflict, Evidence, Resolution } from '../../lib/supplierResolution'
import type { SupplierPick } from './receipt'

/**
 * One quiet line under the Supplier field saying where the supplier came from, or what is
 * suggested (owner, 7 Oct 2026: no large cards). Labels, never percentages: the evidence is
 * a rule, not a probability.
 */
export function SupplierHint({
  resolution,
  pick,
  hasSupplier,
  onUse,
}: {
  resolution: Resolution
  pick: SupplierPick
  hasSupplier: boolean
  onUse: (c: Candidate) => void
}) {
  const t = useT()
  const because = (e: Evidence) =>
    e === 'product' ? t('จากผู้ขายประจำของสินค้า') : e === 'alternate' ? t('จากผู้ขายสำรองที่ตั้งไว้ในสินค้า') : e === 'ocr' ? t('จากชื่อผู้ขายบนบิล') : e === 'history' ? t('จากประวัติการรับ') : t('จากใบสั่งซื้อ')

  if (resolution.kind === 'LOCKED') {
    return (
      <p className="flex items-center gap-1 text-xs text-ink-soft">
        <Icon name="clipboardList" size={14} />
        {t('จาก {po}', { po: resolution.poDocNo })}
      </p>
    )
  }
  if (hasSupplier && pick === 'auto') {
    return (
      <p className="flex items-center gap-1 text-xs text-in">
        <Icon name="checkCircle" size={14} />
        {t('เลือกให้อัตโนมัติจากสินค้าที่เลือก')}
      </p>
    )
  }
  if (hasSupplier && pick === 'ocr') {
    return (
      <p className="flex items-center gap-1 text-xs text-ink-soft">
        <Icon name="sparkles" size={14} />
        {t('อ่านจากบิล — ตรวจให้ตรงก่อนรับ')}
      </p>
    )
  }
  if (hasSupplier) return null
  if (resolution.kind === 'SUGGEST') {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
        <span>
          {t('แนะนำ: {name}', { name: resolution.candidate.supplierName })} · {because(resolution.because)}
        </span>
        <Button variant="secondary" size="sm" className="text-xs" onClick={() => onUse(resolution.candidate)}>
          {t('ใช้ผู้ขายนี้')}
        </Button>
      </div>
    )
  }
  if (resolution.kind === 'AMBIGUOUS') {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
        <span>{t('สินค้านี้ซื้อได้จากหลายผู้ขาย — เลือกเอง:')}</span>
        {resolution.candidates.slice(0, 4).map((c) => (
          <Button key={c.supplierId} variant="secondary" size="sm" className="text-xs" onClick={() => onUse(c)}>
            {c.supplierName}
          </Button>
        ))}
      </div>
    )
  }
  return null
}

/** The bill names one supplier and the products' own mapping another: a person decides. */
export function SupplierMismatch({ resolution }: { resolution: Resolution }) {
  const t = useT()
  if (resolution.kind !== 'MISMATCH') return null
  return (
    <AlertBanner tone="warn" icon="warning">
      {t('ผู้ขายไม่ตรงกัน: บิลระบุ {ocr} แต่สินค้าผูกกับ {mapped}', { ocr: resolution.ocr.supplierName, mapped: resolution.mapped.map((c) => c.supplierName).join(', ') })}
      <span className="mt-0.5 block text-xs font-normal">{t('ตรวจบิลกับสินค้าก่อนเลือกผู้ขาย — ระบบไม่เลือกให้')}</span>
    </AlertBanner>
  )
}

/** Lines that are not this supplier's: never switched silently. */
export function SupplierConflicts({
  supplierName,
  conflicts,
  onRemove,
  onSplit,
}: {
  supplierName: string
  conflicts: Conflict[]
  onRemove: (productId: string) => void
  onSplit: (productIds: string[]) => void
}) {
  const t = useT()
  if (!conflicts.length) return null
  return (
    <AlertBanner tone="warn" icon="warning">
      <ul className="space-y-1">
        {conflicts.map((c) => (
          <li key={c.productId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {t('{product} ผูกกับ {mapped} แต่ใบรับนี้เป็นของ {supplier}', {
                product: c.productName,
                mapped: c.mappedTo.map((m) => m.supplierName).join(' / ') || t('ผู้ขายอื่น'),
                supplier: supplierName,
              })}
            </span>
            <button type="button" className="cursor-pointer text-xs font-medium underline" onClick={() => onRemove(c.productId)}>
              {t('เอาออก')}
            </button>
          </li>
        ))}
      </ul>
      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal">
        {t('ตรวจผู้ขายอีกครั้ง หรือ')}
        <button type="button" className="cursor-pointer font-medium underline" onClick={() => onSplit(conflicts.map((c) => c.productId))}>
          {t('แยกไปใบรับถัดไป')}
        </button>
      </span>
    </AlertBanner>
  )
}
