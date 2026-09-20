import { useState } from 'react'
import { useConfirm } from '../../components/Confirm'
import { DataTable } from '../../components/DataTable'
import { SiteChip } from '../../components/SiteChip'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, SectionHeader } from '../../components/ui'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { fmtQty } from '../../lib/format'
import { listUnitMigration, migrateProductUnits, type UnitMigrationCandidate } from '../../services/unitMigration'

/**
 * Settings → ดูแลข้อมูล: fold the old per-unit balances into the product's own unit.
 *
 * Lists every product still holding a legacy "#Unit" balance; each converts with one
 * press once every unit involved has a rate on the product, and is shown blocked until
 * then. The owner decides product by product (20 Sep 2026); nothing runs on its own.
 */
export function UnitMigrationSection({ actor }: { actor: { id: string; name: string } }) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const [rows, setRows] = useState<UnitMigrationCandidate[] | null>(null)
  const [busy, setBusy] = useState('')

  async function load() {
    setBusy('load')
    try {
      setRows(await listUnitMigration())
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  async function convert(c: UnitMigrationCandidate) {
    const preview = c.rows.map((r) => `${fmtQty(r.qty)} ${r.unit} → ${fmtQty(r.qty * (c.factors[r.unit] ?? 0))} ${c.unitType}`).join('\n')
    const ok = await confirm({
      title: t('แปลงยอดของ {name}', { name: c.productName }),
      message: t('จะแปลงประวัติ {n} รายการเป็น {unit} ตามอัตราของสินค้า และรวมเข้ายอดหลัก', { n: c.legacyMovements, unit: c.unitType }) + '\n\n' + preview,
      confirmText: t('แปลง'),
    })
    if (!ok) return
    setBusy(c.productId)
    try {
      const r = await migrateProductUnits({ productId: c.productId, actor })
      toast.success(t('แปลงแล้ว {n} รายการ — {name}', { n: r.converted, name: c.productName }))
      await load()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  return (
    <Card className="p-4">
      <SectionHeader
        icon="adjust"
        title={t('แปลงยอดแยกหน่วยเป็นหน่วยหลัก')}
        description={t('ยอดที่เคยบันทึกแยกหน่วย (เช่น "10 Pack") ก่อน 20 ก.ย. 2569 — กำหนดอัตราที่สินค้าแล้วกดแปลง ระบบจะคิดเป็นหน่วยหลักและรวมยอดให้ ตรวจสอบย้อนหลังได้ทุกรายการ')}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={load} disabled={!!busy}>
          {busy === 'load' ? t('กำลังตรวจ...') : rows === null ? t('ตรวจหายอดแยกหน่วย') : t('ตรวจอีกครั้ง')}
        </Button>
        {rows !== null && (
          <span className="text-sm text-ink-soft">
            {rows.length === 0 ? t('ไม่มียอดแยกหน่วยค้างอยู่') : t('เหลือ {n} สินค้า', { n: rows.length })}
          </span>
        )}
      </div>
      {rows !== null && rows.length > 0 && (
        <div className="mt-3">
          <DataTable
            rows={rows}
            rowKey={(c) => c.productId}
            minWidth={720}
            columns={[
              { key: 'name', header: t('สินค้า'), primary: true, cell: (c) => <span className="font-medium text-ink">{c.productName}</span> },
              {
                key: 'rows',
                header: t('ยอดแยกหน่วย'),
                cell: (c) => (
                  <div className="space-y-0.5 text-xs">
                    {c.rows.map((r) => (
                      <div key={`${r.locationId}-${r.unit}`} className="flex flex-wrap items-center gap-1">
                        <span className="num font-semibold text-ink">{fmtQty(r.qty)} {r.unit}</span>
                        <SiteChip locationId={r.locationId} />
                      </div>
                    ))}
                    {c.rows.length === 0 && <span className="text-ink-faint">{t('ยอดเป็น 0 — เหลือแต่ประวัติ')}</span>}
                  </div>
                ),
              },
              {
                key: 'rate',
                header: t('อัตราแปลง'),
                cell: (c) => (
                  <div className="space-y-0.5 text-xs">
                    {Object.entries(c.factors).map(([u, f]) =>
                      f === null ? (
                        <Badge key={u} color="red">{t('ยังไม่กำหนด {unit}', { unit: u })}</Badge>
                      ) : (
                        <div key={u}>1 {u} = {fmtQty(f)} {c.unitType}</div>
                      ),
                    )}
                  </div>
                ),
              },
              { key: 'n', header: t('ประวัติ'), align: 'right', cell: (c) => c.legacyMovements },
              {
                key: 'act',
                header: '',
                align: 'right',
                cell: (c) =>
                  c.blockedUnits.length > 0 ? (
                    <span className="text-xs text-ink-faint">{t('กำหนดอัตราที่สินค้าก่อน')}</span>
                  ) : (
                    <Button onClick={() => void convert(c)} disabled={!!busy}>
                      {busy === c.productId ? t('กำลังแปลง...') : t('แปลง')}
                    </Button>
                  ),
              },
            ]}
          />
        </div>
      )}
    </Card>
  )
}
