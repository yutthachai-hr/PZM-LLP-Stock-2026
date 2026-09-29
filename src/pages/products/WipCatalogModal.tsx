import { useMemo, useState } from 'react'
import { useBrand } from '../../brand/BrandContext'
import { brandDef } from '../../brand/brand'
import { useToast } from '../../components/Toast'
import { AlertBanner, Button, Modal } from '../../components/ui'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { missingWip, WIP_CATEGORY, WIP_ITEMS } from '../../seed/wip'
import { createProduct } from '../../services/products'
import type { Product } from '../../types'

/**
 * Add the work-in-process items to this brand's catalogue (owner, 29 Sep 2026): the list in
 * seed/wip.ts, shown in full for an admin to check first — codes, names, units, the tray a
 * dough ball comes on — and added only on the press, skipping any code already there.
 */
export function WipCatalogModal({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const t = useT()
  const toast = useToast()
  const { brand } = useBrand()
  const key = brand ? (brandDef(brand).sheetKey as 'PZM' | 'LLP') : null
  const items = useMemo(() => (key && WIP_ITEMS[key]) || [], [key])
  const missing = useMemo(() => new Set(missingWip(items, products).map((i) => i.sku)), [items, products])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)

  async function add() {
    setBusy(true)
    let n = 0
    try {
      for (const i of items) {
        if (!missing.has(i.sku)) continue
        await createProduct({
          sku: i.sku,
          name: i.name,
          category: WIP_CATEGORY,
          unit: i.unit,
          unitType: i.unitType,
          minStock: 0,
          ...(i.unitConversions ? { unitConversions: i.unitConversions } : {}),
        })
        n++
        setDone(n)
      }
      toast.success(t('เพิ่มสินค้า WIP แล้ว {n} รายการ', { n }))
      onClose()
    } catch (e) {
      toast.error(`${t('เพิ่มได้ {n} รายการ แล้วหยุด:', { n })} ${errText(e, t)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title={t('เพิ่มสินค้า WIP (งานระหว่างทำ)')} wide>
      <div className="space-y-3 text-sm">
        <AlertBanner tone="info" icon="info">
          {t('รายการ WIP จากไฟล์ปิดสต๊อก ตั้งรหัสให้แล้ว — ตรวจก่อนกดเพิ่ม รายการที่มีรหัสนี้อยู่แล้วจะไม่เพิ่มซ้ำ แก้ชื่อ/หน่วยทีหลังได้ที่หน้าสินค้า')}
        </AlertBanner>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-sunken text-left text-xs text-ink-soft">
              <tr>
                <th className="px-3 py-2">{t('รหัส')}</th>
                <th className="px-3 py-2">{t('ชื่อ')}</th>
                <th className="px-3 py-2">{t('หน่วย')}</th>
                <th className="px-3 py-2">{t('อัตราแปลง')}</th>
                <th className="px-3 py-2">{t('ที่มาในไฟล์')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.sku} className="row-hover border-t border-line">
                  <td className="px-3 py-2 font-mono text-xs">{i.sku}</td>
                  <td className="px-3 py-2 text-ink">{i.name}</td>
                  <td className="px-3 py-2">
                    {i.unitType}
                    {i.unit !== i.unitType && <span className="text-xs text-ink-faint"> ({i.unit})</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-soft">
                    {(i.unitConversions ?? []).map((c) => `1 ${c.label} = ${c.size} ${i.unitType}`).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-faint">{i.source}</td>
                  <td className="px-3 py-2 text-right text-xs">
                    {missing.has(i.sku) ? <span className="text-in">{t('จะเพิ่ม')}</span> : <span className="text-ink-faint">{t('มีแล้ว')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {busy && <span className="text-xs text-ink-soft">{t('กำลังเพิ่ม {n}/{total}', { n: done, total: missing.size })}</span>}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('ยกเลิก')}
          </Button>
          <Button onClick={() => void add()} disabled={busy || missing.size === 0}>
            {t('เพิ่ม {n} รายการ', { n: missing.size })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
