import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { LedgerWindowNotice } from '../components/LedgerWindowNotice'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select } from '../components/ui'
import { editMovementQty, voidMovement, getMovementImage } from '../services/stock'
import { fmtQty, formatThaiDate, msToDateInput, dateInputToMs, dayRange } from '../lib/format'
import { effectAt, effectOverall, stockCard } from '../lib/ledger'
import { ADJUST_REASONS, type MovementType, type StockMovement } from '../types'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'

const TYPE_LABEL: Record<MovementType, string> = {
  receive: 'รับเข้า', // i18n-key
  issue: 'เบิก/โอน', // i18n-key
  adjust: 'ปรับ', // i18n-key
  consume: 'เบิกใช้', // i18n-key
}
const TYPE_COLOR: Record<MovementType, 'green' | 'blue' | 'amber' | 'red'> = {
  receive: 'green',
  issue: 'blue',
  adjust: 'amber',
  consume: 'red',
}

export function MovementsPage() {
  const t = useT()
  const { movements, locations, products, locationById, ensureMovementsFrom } = useData()
  const { user } = useAuth()
  const toast = useToast() // i18n-key
  const confirm = useConfirm()
  const isAdmin = user?.role === 'admin'

  const [productId, setProductId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [fromStr, setFromStr] = useState('')
  const [toStr, setToStr] = useState('')

  // Picking a date before the loaded window would silently show nothing, so widen it.
  // Clearing the date does NOT widen: that is the default state, and loading the whole
  // ledger on every visit is the cost this window exists to avoid. The banner below
  // says what is loaded and offers to fetch the rest.
  useEffect(() => {
    if (fromStr) ensureMovementsFrom(dateInputToMs(fromStr))
  }, [fromStr, ensureMovementsFrom])
  const [editing, setEditing] = useState<StockMovement | null>(null)
  const [photoDoc, setPhotoDoc] = useState<string | null>(null)

  const stockCardMode = !!productId && !!locationId

  // The rows to show and the balance each one leaves behind are two different questions.
  // stockCard() answers the second from EVERY movement in scope, so a date or type filter
  // changes what is listed without changing what the warehouse actually held.
  const card = useMemo(() => {
    const { from, to } = dayRange(fromStr, toStr)
    return stockCard(movements, {
      productId: productId || undefined,
      locationId: locationId || undefined,
      from,
      to,
      type: (typeFilter || '') as MovementType | '',
    })
  }, [movements, productId, locationId, typeFilter, fromStr, toStr])

  // Newest first on screen; the balances were worked out oldest first.
  const rows = useMemo(() => [...card.rows].reverse(), [card])

  const balances = useMemo(
    () => new Map(card.rows.map((r) => [r.movement.id, r.balance ?? 0])),
    [card],
  )

  // Voided rows are still worth seeing in the history, but they carry no balance.
  const voidedRows = useMemo(() => {
    const { from, to } = dayRange(fromStr, toStr)
    return movements
      .filter((m) => m.voided)
      .filter((m) => (productId ? m.productId === productId : true))
      .filter((m) =>
        locationId ? m.fromLocationId === locationId || m.toLocationId === locationId : true,
      )
      .filter((m) => (typeFilter ? m.type === typeFilter : true))
      .filter((m) => m.date >= from && m.date < to)
  }, [movements, productId, locationId, typeFilter, fromStr, toStr])

  const filtered = useMemo(
    () =>
      [...rows.map((r) => r.movement), ...voidedRows].sort(
        (a, b) => b.date - a.date || b.createdAt - a.createdAt,
      ),
    [rows, voidedRows],
  )

  async function doVoid(m: StockMovement) {
    const ok = await confirm({
      title: t("ยกเลิกรายการ"),
      message: t('ยกเลิกรายการ {docNo} ({name})? ระบบจะคืนยอดสต๊อกกลับ', { docNo: m.docNo, name: m.productName }),
      danger: true,
      confirmText: t("ยกเลิกรายการ"),
    })
    if (!ok) return
    try {
      await voidMovement(m.id, { id: user!.id, name: user!.name })
      toast.success(t("ยกเลิกรายการแล้ว (คืนสต๊อก)"))
    } catch (e) {
      toast.error(t("ทำรายการไม่สำเร็จ:") + ' ' + errText(e, t))
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t("📜 ประวัติ / Stock Card")}</h1>
        <p className="text-sm text-slate-500">
          {t("ทุกการเคลื่อนไหวถูกบันทึกถาวร — เลือกสินค้า + คลัง เพื่อดูยอดคงเหลือแบบ Stock Card")}
        </p>
      </div>

      <Card className="p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label={t("สินค้า")}>
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">{t("ทุกสินค้า")}</option>
              {[...products]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t("คลัง/สาขา")}>
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">{t("ทุกคลัง")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("ประเภท")}>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">{t("ทั้งหมด")}</option>
              <option value="receive">{t("รับเข้า")}</option>
              <option value="issue">{t("เบิก/โอน")}</option>
              <option value="consume">{t("เบิกใช้")}</option>
              <option value="adjust">{t("ปรับ")}</option>
            </Select>
          </Field>
          <Field label={t("ตั้งแต่วันที่")}>
            <Input type="date" value={fromStr} onChange={(e) => setFromStr(e.target.value)} />
          </Field>
          <Field label={t("ถึงวันที่")}>
            <Input type="date" value={toStr} onChange={(e) => setToStr(e.target.value)} />
          </Field>
        </div>
        {stockCardMode && (
          <p className="mt-2 text-xs text-emerald-700">
            {t("📗 โหมด Stock Card: แสดงยอดคงเหลือสะสมของสินค้านี้ที่คลังที่เลือก")}
          </p>
        )}
      </Card>

      <LedgerWindowNotice />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon="history" title={t("ไม่พบรายการ")} hint={t("ลองปรับตัวกรอง")} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-240px)]">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs uppercase text-slate-500 shadow-sm">
                <tr>
                  <th className="px-3 py-2">{t("วันที่")}</th>
                  <th className="px-3 py-2">{t("เลขที่")}</th>
                  <th className="px-3 py-2">{t("ประเภท")}</th>
                  <th className="px-3 py-2">{t("สินค้า")}</th>
                  <th className="px-3 py-2">{t("คลัง")}</th>
                  <th className="px-3 py-2 text-right">{t("จำนวน")}</th>
                  {stockCardMode && <th className="px-3 py-2 text-right">{t("คงเหลือ")}</th>}
                  <th className="px-3 py-2">{t("โดย")}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((m) => {
                  const eff = locationId ? effectAt(m, locationId) : effectOverall(m)
                  return (
                    <tr key={m.id} className={m.voided ? 'bg-slate-50 text-slate-400' : ''}>
                      <td className="whitespace-nowrap px-3 py-2">{formatThaiDate(m.date)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{m.docNo}</td>
                      <td className="px-3 py-2">
                        <Badge color={TYPE_COLOR[m.type]}>{t(TYPE_LABEL[m.type])}</Badge>
                        {m.voided && <span className="ml-1 text-xs">{t("(ยกเลิก)")}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 font-medium text-slate-700">
                          {m.productName}
                          {m.hasPhoto && (
                            <button
                              onClick={() => setPhotoDoc(m.docNo)}
                              title={t("ดูรูปหลักฐาน")}
                              className="text-sm"
                            >
                              📷
                            </button>
                          )}
                        </div>
                        {m.reason && (
                          <div className="text-xs text-slate-400">
                            {t(ADJUST_REASONS.find((r) => r.value === m.reason)?.label ?? m.reason)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {m.fromLocationId && locationById(m.fromLocationId)?.name}
                        {m.fromLocationId && m.toLocationId && ' → '}
                        {m.toLocationId && locationById(m.toLocationId)?.name}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${
                          eff < 0 ? 'text-rose-600' : 'text-emerald-700'
                        }`}
                      >
                        {eff > 0 ? '+' : ''}
                        {fmtQty(eff)} {m.unit}
                      </td>
                      {stockCardMode && (
                        <td className="px-3 py-2 text-right font-semibold text-slate-800">
                          {fmtQty(balances.get(m.id) ?? 0)}
                        </td>
                      )}
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {m.byUserName}
                        {m.updatedByName && <div className="text-amber-600">{t('แก้ไข:')} {m.updatedByName}</div>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!m.voided && (
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" onClick={() => setEditing(m)}>
                              {t("แก้ไข")}
                            </Button>
                            {isAdmin && (
                              <button
                                onClick={() => doVoid(m)}
                                className="rounded px-2 text-xs text-rose-600 hover:bg-rose-50"
                              >
                                {t("ยกเลิก")}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing && (
        <EditMovementModal movement={editing} onClose={() => setEditing(null)} />
      )}
      {photoDoc && <PhotoModal docNo={photoDoc} onClose={() => setPhotoDoc(null)} />}
    </div>
  )
}

function PhotoModal({ docNo, onClose }: { docNo: string; onClose: () => void }) {
  const t = useT()
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let on = true
    // The spinner used to stop only on success, so a photo that failed to load left the
    // dialog saying "loading" for as long as it was open.
    getMovementImage(docNo)
      .then((u) => {
        if (on) setUrl(u)
      })
      .catch(() => {
        if (on) setUrl(null)
      })
      .finally(() => {
        if (on) setLoading(false)
      })
    return () => {
      on = false
    }
  }, [docNo])
  return (
    <Modal open onClose={onClose} title={t('รูปหลักฐาน — {docNo}', { docNo })}>
      {loading ? (
        <div className="p-6 text-center text-sm text-slate-400">{t("กำลังโหลด...")}</div>
      ) : url ? (
        <img src={url} alt={t('หลักฐาน')} className="mx-auto max-h-[70vh] rounded-lg" />
      ) : (
        <div className="p-6 text-center text-sm text-slate-400">{t("ไม่พบรูป")}</div>
      )}
    </Modal>
  )
}

function EditMovementModal({
  movement,
  onClose,
}: {
  movement: StockMovement
  onClose: () => void
}) {
  const t = useT()
  const { user } = useAuth()
  const toast = useToast()
  const [qty, setQty] = useState(movement.qty)
  const [dateStr, setDateStr] = useState(msToDateInput(movement.date))
  const [note, setNote] = useState(movement.note ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!(qty > 0)) return toast.error(t("จำนวนต้องมากกว่า 0"))
    setBusy(true)
    try {
      await editMovementQty({
        movementId: movement.id,
        newQty: qty,
        newDate: dateInputToMs(dateStr),
        newNote: note,
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
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="font-medium">{movement.productName}</span>
          <span className="text-slate-500"> — {t(TYPE_LABEL[movement.type])}</span>
        </div>
        <Field label={t("จำนวน")} required>
          <Input
            type="number"
            step="any"
            min={0}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
        </Field>
        <Field label={t("วันที่")}>
          <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
        </Field>
        <Field label={t("หมายเหตุ")}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
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

/** Effect of a movement on a specific location's balance. */

