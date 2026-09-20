import { useMemo, useState } from 'react'
import { SiteSelect } from '../../components/SiteChip'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useToast } from '../Toast'
import { Button, Field, Input, Modal, Select } from '../ui'
import { editMovement } from '../../services/stock'
import { useEntryUnits } from '../../services/entryUnits'
import { fmtQty, formatThaiDate, msToDateInput, dateInputToMs } from '../../lib/format'
import { shownUnit } from '../../lib/ledger'
import { sameUnit } from '../../lib/units'
import { factorOf, isLegacyUnitRow, resolveFactor, toBase } from '../../lib/uom'
import { entryUnitsFor } from '../QtyInput'
import { DefineConversionModal } from '../DefineConversionModal'
import type { StockMovement } from '../../types'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { describeEditChange, TYPE_LABEL } from './labels'

/** Correct one row of the ledger. The balances it touched follow; the edit is signed and kept. */
export function EditMovementModal({
  movement,
  onClose,
}: {
  movement: StockMovement
  onClose: () => void
}) {
  const t = useT()
  const { user } = useAuth()
  const { locations, productById } = useData()
  const toast = useToast()
  const plainUnits = useEntryUnits()
  // The number shown is the one that was keyed: entryQty for a row keyed in another unit,
  // qty for one keyed in the product's own. The engine converts (lib/uom.ts).
  const keyed = shownUnit(movement)
  const [qty, setQty] = useState(movement.entryQty ?? movement.qty)
  const [dateStr, setDateStr] = useState(msToDateInput(movement.date))
  const [note, setNote] = useState(movement.note ?? '')
  const [entryUnit, setEntryUnit] = useState(keyed)
  const [fromId, setFromId] = useState(movement.fromLocationId ?? '')
  const [toId, setToId] = useState(movement.toLocationId ?? '')
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<string | null>(null)

  const product = productById(movement.productId)
  const baseUnit = product?.unitType ?? movement.unit
  const legacy = isLegacyUnitRow(movement)
  // The units this row could be keyed in, each with its rate for this product, or none
  // yet. Whatever it is filed under now stays offered even if the owner has since removed it.
  const unitChoices = useMemo(() => {
    const out = entryUnitsFor(baseUnit, plainUnits, product?.unitConversions)
    if (!out.some((u) => sameUnit(u.records, keyed))) {
      out.push({ key: `plain:${keyed}`, label: keyed, records: keyed, factor: resolveFactor({ unitType: baseUnit, unitConversions: product?.unitConversions }, keyed) })
    }
    return out
  }, [baseUnit, plainUnits, product?.unitConversions, keyed])
  const chosen = unitChoices.find((u) => sameUnit(u.records, entryUnit)) ?? unitChoices[0]
  const isBase = sameUnit(entryUnit, baseUnit)
  // What will be filed, at the rate this row already carries when the unit is unchanged,
  // else at the product's current rate.
  const factor = isBase ? 1 : sameUnit(entryUnit, keyed) && !legacy ? factorOf(movement) : chosen.factor
  const preview = factor !== null && qty > 0 ? toBase(qty, factor) : null

  function pickUnit(next: string) {
    const u = unitChoices.find((x) => sameUnit(x.records, next))
    if (u && u.factor === null && !sameUnit(next, keyed)) {
      if (product) setAsking(next)
      return
    }
    setEntryUnit(next)
  }

  const active = useMemo(() => locations.filter((l) => l.active !== false), [locations])

  async function save() {
    if (!(qty > 0)) return toast.error(t("จำนวนต้องมากกว่า 0"))
    setBusy(true)
    try {
      await editMovement({
        movementId: movement.id,
        patch: {
          // A row keyed in the product's own unit is edited by qty; any other by entryQty.
          ...(isBase ? { qty } : { entryQty: qty }),
          date: dateInputToMs(dateStr),
          note,
          // The product's own unit is stored as "no unit of its own", same as when keyed.
          entryUnit: isBase ? '' : entryUnit,
          ...(movement.fromLocationId ? { fromLocationId: fromId } : {}),
          ...(movement.toLocationId ? { toLocationId: toId } : {}),
        },
        actor: { id: user!.id, name: user!.name },
      })
      toast.success(t("แก้ไขรายการแล้ว (ปรับยอดสต๊อกให้อัตโนมัติ)"))
      onClose()
    } catch (e) {
      toast.error(t("แก้ไขไม่สำเร็จ:") + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('แก้ไขรายการ {docNo}', { docNo: movement.docNo })}>
      <div className="space-y-4">
        <div className="rounded-lg bg-sunken px-3 py-2 text-sm">
          <span className="font-medium">{movement.productName}</span>
          <span className="text-ink-soft"> — {t(TYPE_LABEL[movement.type])}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("จำนวน")} required hint={preview !== null && !isBase ? `= ${fmtQty(preview)} ${baseUnit}` : undefined}>
            <Input
              type="number"
              step="any"
              min={0}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
            />
          </Field>
          {/* Correcting the unit here is the point: the alternative was cancelling the row
              and keying the whole delivery again. The quantity is re-converted. */}
          <Field label={t("หน่วย")}>
            <Select value={chosen.records} onChange={(e) => pickUnit(e.target.value)}>
              {unitChoices.map((u) => (
                <option key={u.key} value={u.records} disabled={u.factor === null && !product && !sameUnit(u.records, keyed)}>
                  {u.translate ? t(u.label) : u.label}
                  {u.factor === null && !sameUnit(u.records, keyed) ? ` ${t('(ยังไม่มีอัตรา)')}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {legacy && (
          <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-warn">
            {factor === null
              ? t('รายการนี้บันทึกไว้เป็น {unit} ตามกติกาเดิม (ยอดแยกหน่วย) ยังไม่มีอัตราแปลงของ {unit} — แก้ได้เฉพาะวันที่/หมายเหตุ จนกว่าจะกำหนดอัตราที่สินค้า', { unit: keyed })
              : t('รายการนี้บันทึกไว้เป็น {unit} ตามกติกาเดิม (ยอดแยกหน่วย) เมื่อบันทึก ระบบจะแปลงเป็น {base} ตามอัตราของสินค้าและรวมเข้ายอดหลัก', { unit: keyed, base: baseUnit })}
          </p>
        )}
        {/* Only the sides this movement already has. A receipt has no source, and giving it
            one would quietly turn it into a transfer under the same document number. */}
        {movement.fromLocationId && (
          <Field label={t("คลังต้นทาง")}>
            <SiteSelect value={fromId} onChange={setFromId} locations={active} />
          </Field>
        )}
        {movement.toLocationId && (
          <Field label={t("คลังปลายทาง")}>
            <SiteSelect value={toId} onChange={setToId} locations={active} />
          </Field>
        )}
        <Field label={t("วันที่")}>
          <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
        </Field>
        <Field label={t("หมายเหตุ")}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {/* Who has already changed this row. Shown here, not only in the report, so the next
            person editing it can see they are not the first. */}
        {movement.edits && movement.edits.length > 0 && (
          <div className="rounded-lg border border-line bg-sunken px-3 py-2">
            <div className="mb-1 text-xs font-semibold text-ink-soft">
              {t('ประวัติการแก้ไข ({count} ครั้ง)', { count: movement.edits.length })}
            </div>
            <ul className="space-y-0.5 text-xs text-ink-soft">
              {movement.edits.map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  {formatThaiDate(e.at)} — <span className="font-medium text-ink">{e.byName}</span>
                  {e.changes?.length
                    ? ` (${e.changes.map((c) => describeEditChange(c, t, formatThaiDate, (id) => locations.find((l) => l.id === id)?.name ?? '')).join(', ')})`
                    : e.changed.length > 0 && ` (${e.changed.map((c) => t(c)).join(', ')})`}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("ยกเลิก")}
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? t("กำลังบันทึก...") : t("บันทึก")}
          </Button>
        </div>
      </div>
      {asking && product && (
        <DefineConversionModal
          product={product}
          label={asking}
          onClose={() => setAsking(null)}
          onSaved={() => {
            setEntryUnit(asking)
            setAsking(null)
          }}
        />
      )}
    </Modal>
  )
}
