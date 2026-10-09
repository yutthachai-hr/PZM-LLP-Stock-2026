import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Badge, Button, Input } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useT } from '../../i18n/I18nContext'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../components/Toast'
import { errText } from '../../i18n/AppError'
import { decideOther, otherIndex, reviewOf, type OtherDecision } from '../../lib/otherItem'
import type { ProductAlias } from '../../lib/productMatch'
import { aliasesOnce, proposeItem } from '../../services/otherItems'
import type { Product, Supplier } from '../../types'

/**
 * Smart "Other" item (R&D, 8 Oct 2026). Opened in place of the usual quantity panel when the
 * picked product is a category's "(OTHER)" catch-all: the person writes what they actually
 * want, and the panel says whether it is a product we already have (use it), one of several
 * (pick), or new (create a code for it here — no trip to the catalogue).
 *
 * Whatever they settle on comes back through `onResolved` as an ordinary product, and the
 * request line is then filled in exactly as for any product: supplier, quantity, unit.
 * Typing reads nothing: the brand's products are already on the device, aliases are read
 * once a session.
 */
const DEBOUNCE_MS = 150

export function OtherItemPanel({
  placeholder,
  products,
  suppliers,
  onResolved,
  onCancel,
}: {
  placeholder: Product
  products: readonly Product[]
  suppliers: readonly Supplier[]
  onResolved: (p: Product) => void
  onCancel: () => void
}) {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const ids = { name: useId(), spec: useId(), unit: useId(), units: useId() }
  const [name, setName] = useState('')
  const [spec, setSpec] = useState('')
  const [unit, setUnit] = useState('')
  const [aliases, setAliases] = useState<ProductAlias[]>([])
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let alive = true
    void aliasesOnce().then((a) => alive && setAliases(a))
    nameRef.current?.focus()
    return () => {
      alive = false
    }
  }, [])

  const [input, setInput] = useState({ name: '', spec: '', unit: '' })
  useEffect(() => {
    const id = setTimeout(() => setInput({ name, spec, unit }), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [name, spec, unit])

  const idx = useMemo(() => otherIndex(products, aliases), [products, aliases])
  const decision: OtherDecision = useMemo(() => decideOther(input, idx), [input, idx])
  const unitChoices = useMemo(() => [...new Set(products.map((p) => p.unitType).filter(Boolean))].sort(), [products])
  const supplierName = (id?: string) => (id ? suppliers.find((s) => s.id === id)?.name : undefined)

  async function create() {
    // "None of these" is always open: a same-named item with another spec is a new item.
    if (!user || (decision.kind !== 'create' && decision.kind !== 'choose') || !unit.trim()) return
    setBusy(true)
    try {
      const r = await proposeItem(
        { name: name.trim(), unit: unit.trim(), placeholderId: placeholder.id, ...(spec.trim() ? { spec: spec.trim() } : {}) },
        { id: user.id, name: user.name },
      )
      const now = Date.now()
      // The listener will deliver the stored product in a moment; the line needs it now.
      onResolved({
        ...(products.find((p) => p.id === r.productId) ?? {
          id: r.productId, sku: r.sku, name: name.trim(), category: placeholder.category, unit: unit.trim(), unitType: unit.trim(),
          minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now, review: 'pending',
          ...(spec.trim() ? { spec: spec.trim() } : {}),
        }),
      } as Product)
      toast.success(r.created ? t('สร้างรหัส {sku} แล้ว — รอผู้ดูแลตรวจสอบ', { sku: r.sku }) : t('มีรายการนี้อยู่แล้ว ({sku}) — ใช้รายการเดิม', { sku: r.sku }))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const row = (p: Product, why: string, action: string) => (
    <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="break-words text-sm font-medium text-ink">{p.name}</div>
        <div className="flex flex-wrap gap-2 text-xs text-ink-faint">
          <span className="doc-no">{p.sku}</span>
          {p.unitType && <span>{p.unitType}</span>}
          {p.spec && <span>{p.spec}</span>}
          {supplierName(p.supplierId) && <span>{supplierName(p.supplierId)}</span>}
          {reviewOf(p) === 'pending' && <Badge color="amber">{t('รอตรวจสอบ')}</Badge>}
          {why && <span className="text-warn">{why}</span>}
        </div>
      </div>
      <Button variant="secondary" onClick={() => onResolved(p)}>
        {action}
      </Button>
    </li>
  )

  return (
    <section aria-label={t('ระบุสินค้าอื่น')} className="space-y-3 rounded-lg border border-line-strong bg-surface p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-ink">{t('สินค้าอื่น ๆ — {category}', { category: placeholder.category })}</div>
          <p className="text-xs text-ink-faint">{t('พิมพ์ชื่อสินค้าที่ต้องการ ระบบจะหารายการเดิมให้ ถ้าไม่มีจะสร้างรหัสใหม่ให้เอง')}</p>
        </div>
        <button type="button" onClick={onCancel} className="text-xs text-brand">
          {t('เปลี่ยน')}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label htmlFor={ids.name} className="mb-1 block text-xs font-medium text-ink">{t('ชื่อสินค้า')} *</label>
          <Input id={ids.name} ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} maxLength={300} placeholder={t('เช่น ผงซูแมค')} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={ids.spec} className="mb-1 block text-xs font-medium text-ink">{t('สเปก / ขนาด (ถ้ามี)')}</label>
          <Input id={ids.spec} value={spec} onChange={(e) => setSpec(e.target.value)} maxLength={300} placeholder={t('เช่น 500 g ถุง')} />
        </div>
        <div>
          <label htmlFor={ids.unit} className="mb-1 block text-xs font-medium text-ink">{t('หน่วย')}</label>
          <Input id={ids.unit} value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={60} list={ids.units} placeholder="KG / EA / PACK" />
          <datalist id={ids.units}>
            {unitChoices.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
      </div>

      <div aria-live="polite">
        {decision.kind === 'use' && (
          <div className="rounded-lg border border-ok/40 bg-ok-soft/40">
            <div className="px-3 pt-2 text-xs font-semibold text-ok">{t('สินค้าเดิม — ใช้รหัสเดิม')}</div>
            <ul>{row(decision.product, '', t('ใช้รายการนี้'))}</ul>
          </div>
        )}
        {decision.kind === 'choose' && (
          <div className="rounded-lg border border-warn/40">
            <div className="px-3 pt-2 text-xs font-semibold text-warn">{t('มีรายการที่อาจตรงกัน — โปรดเลือก หรือสร้างใหม่ถ้าไม่ใช่')}</div>
            <ul className="divide-y divide-line">
              {decision.candidates.map((c) =>
                row(
                  c.product,
                  c.why === 'same-name-other-spec' ? t('ชื่อเหมือน แต่หน่วยหรือสเปกต่าง') : c.why === 'pending' ? t('มีคนเสนอไว้แล้ว') : c.why === 'same-name' ? t('ชื่อซ้ำหลายรายการ') : '',
                  t('ใช้รายการนี้'),
                ),
              )}
            </ul>
          </div>
        )}
        {decision.kind === 'create' && decision.candidates.length > 0 && (
          <div className="rounded-lg border border-line">
            <div className="px-3 pt-2 text-xs font-semibold text-ink-soft">{t('รายการที่ใกล้เคียง')}</div>
            <ul className="divide-y divide-line">{decision.candidates.map((c) => row(c.product, '', t('ใช้รายการนี้')))}</ul>
          </div>
        )}
      </div>

      {(decision.kind === 'create' || decision.kind === 'choose') && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-ink-faint">{decision.kind === 'create' ? t('ไม่พบสินค้านี้ในระบบ') : t('ไม่ใช่รายการข้างบน?')}</span>
          <Button onClick={() => void create()} disabled={busy || !unit.trim()}>
            <Icon name="plus" size={16} />
            {t('สร้างรหัสใหม่และใช้')}
          </Button>
        </div>
      )}
      {(decision.kind === 'create' || decision.kind === 'choose') && !unit.trim() && <p className="text-right text-xs text-ink-faint">{t('ระบุหน่วยก่อนสร้างรายการใหม่')}</p>}
    </section>
  )
}
