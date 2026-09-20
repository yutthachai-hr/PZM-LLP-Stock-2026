import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useToast } from '../Toast'
import { Button, Field, Input, Modal, Select } from '../ui'
import { editMovement } from '../../services/stock'
import { useEntryUnits } from '../../services/entryUnits'
import { formatThaiDate, msToDateInput, dateInputToMs } from '../../lib/format'
import { shownUnit } from '../../lib/ledger'
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
  const [qty, setQty] = useState(movement.qty)
  const [dateStr, setDateStr] = useState(msToDateInput(movement.date))
  const [note, setNote] = useState(movement.note ?? '')
  const [entryUnit, setEntryUnit] = useState(shownUnit(movement))
  const [fromId, setFromId] = useState(movement.fromLocationId ?? '')
  const [toId, setToId] = useState(movement.toLocationId ?? '')
  const [busy, setBusy] = useState(false)

  // The units this row could be counted in: the product's own, plus whatever the owner
  // maintains in Settings. No conversion — changing this moves the number to another
  // balance, it does not rescale it.
  const baseUnit = productById(movement.productId)?.unitType ?? movement.unit
  const unitChoices = useMemo(() => {
    const out = [baseUnit, ...plainUnits]
    // Whatever it is filed under now stays offered even if the owner has since removed it.
    if (!out.some((u) => u === entryUnit)) out.push(entryUnit)
    return [...new Set(out.filter(Boolean))]
  }, [baseUnit, plainUnits, entryUnit])

  const active = useMemo(() => locations.filter((l) => l.active !== false), [locations])

  async function save() {
    if (!(qty > 0)) return toast.error(t("จำนวนต้องมากกว่า 0"))
    setBusy(true)
    try {
      await editMovement({
        movementId: movement.id,
        patch: {
          qty,
          date: dateInputToMs(dateStr),
          note,
          // The product's own unit is stored as "no unit of its own", same as when keyed.
          entryUnit: entryUnit === baseUnit ? '' : entryUnit,
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
          <Field label={t("จำนวน")} required>
            <Input
              type="number"
              step="any"
              min={0}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
            />
          </Field>
          {/* Correcting the unit here is the point: the alternative was cancelling the row
              and keying the whole delivery again. */}
          <Field label={t("หน่วย")}>
            <Select value={entryUnit} onChange={(e) => setEntryUnit(e.target.value)}>
              {unitChoices.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {/* Only the sides this movement already has. A receipt has no source, and giving it
            one would quietly turn it into a transfer under the same document number. */}
        {movement.fromLocationId && (
          <Field label={t("คลังต้นทาง")}>
            <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {active.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {movement.toLocationId && (
          <Field label={t("คลังปลายทาง")}>
            <Select value={toId} onChange={(e) => setToId(e.target.value)}>
              {active.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
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
    </Modal>
  )
}
