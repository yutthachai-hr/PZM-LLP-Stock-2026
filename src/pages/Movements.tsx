import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { useData } from '../data/DataContext'
import { LedgerWindowNotice } from '../components/LedgerWindowNotice'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
} from '../components/ui'
import { DataTable, type Column } from '../components/DataTable'
import { editMovement, voidMovement, getMovementImage } from '../services/stock'
import { useEntryUnits } from '../services/entryUnits'
import { fmtQty, formatThaiDate, msToDateInput, dateInputToMs, dayRange } from '../lib/format'
import { effectAt, effectOverall, shownUnit, stockCard } from '../lib/ledger'
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

  // Arriving from the top-bar search or a low-stock link: the point of that link is the
  // stock card for one product, so the filter it implies has to be on when the page opens.
  // The address is the filter, rather than a copy of it kept in state. Held in state, the
  // initial value was read once when the page mounted: searching for a second product while
  // already on this page changed the address and nothing else, so the search looked broken
  // for every product after the first.
  const [params, setParams] = useSearchParams()
  const productId = params.get('product') ?? ''
  const locationId = params.get('location') ?? ''

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const setProductId = (id: string) => setParam('product', id)
  const setLocationId = (id: string) => setParam('location', id)
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
      message: t('ยกเลิกรายการ {docNo} ({name})? ระบบจะคืนยอดสต๊อกกลับ', { docNo: m.docNo, name: m.productName, }),
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

  const columns = useMemo<Column<StockMovement>[]>(() => {
    const list: Column<StockMovement>[] = [
      {
        key: 'product',
        header: t('สินค้า'),
        primary: true,
        headerClassName: 'min-w-[200px]',
        cell: (m) => (
          <>
            <div className="flex items-center gap-2 font-medium text-ink">
              {m.productName}
              {m.hasPhoto && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setPhotoDoc(m.docNo)
                  }}
                  title={t('ดูรูปหลักฐาน')}
                  className="text-sm"
                >
                  <Icon name="camera" size={16} />
                </button>
              )}
            </div>
            {m.reason && (
              <div className="text-xs text-ink-faint">
                {t(ADJUST_REASONS.find((r) => r.value === m.reason)?.label ?? m.reason)}
              </div>
            )}
          </>
        ),
      },
      {
        key: 'date',
        header: t('วันที่'),
        className: 'whitespace-nowrap',
        cell: (m) => formatThaiDate(m.date),
      },
      {
        key: 'docNo',
        header: t('เลขที่'),
        className: 'doc-no whitespace-nowrap text-xs text-ink-soft',
        cell: (m) => m.docNo,
      },
      {
        key: 'type',
        header: t('ประเภท'),
        cell: (m) => (
          <>
            <Badge color={TYPE_COLOR[m.type]}>{t(TYPE_LABEL[m.type])}</Badge>
            {m.voided && <span className="ml-1 text-xs">{t('(ยกเลิก)')}</span>}
          </>
        ),
      },
      {
        key: 'location',
        header: t('คลัง'),
        className: 'text-xs text-ink-soft',
        cell: (m) => (
          <>
            {m.fromLocationId && locationById(m.fromLocationId)?.name}
            {m.fromLocationId && m.toLocationId && (
              <Icon name="arrowRight" size={12} className="mx-0.5 inline align-middle" />
            )}
            {m.toLocationId && locationById(m.toLocationId)?.name}
          </>
        ),
      },
      {
        key: 'qty',
        header: t('จำนวน'),
        align: 'right',
        className: 'num font-semibold',
        cell: (m) => {
          const eff = locationId ? effectAt(m, locationId) : effectOverall(m)
          return (
            <span className={eff < 0 ? 'text-out' : 'text-in'}>
              {eff > 0 ? '+' : ''}
              {fmtQty(eff)} {shownUnit(m)}
            </span>
          )
        },
      },
    ]
    if (stockCardMode) {
      list.push({
        key: 'balance',
        header: t('คงเหลือ'),
        align: 'right',
        className: 'num font-semibold text-ink',
        cell: (m) => fmtQty(balances.get(m.id) ?? 0),
      })
    }
    list.push(
      {
        key: 'by',
        header: t('โดย'),
        className: 'text-xs text-ink-soft',
        cell: (m) => (
          <>
            {m.byUserName}
            {m.updatedByName && (
              <div className="text-warn">
                {t('แก้ไข:')} {m.updatedByName}
              </div>
            )}
          </>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tableOnly: true,
        cell: (m) =>
          m.voided ? null : (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" onClick={() => setEditing(m)}>
                {t('แก้ไข')}
              </Button>
              {isAdmin && (
                <button
                  onClick={() => doVoid(m)}
                  className="rounded px-2 text-xs font-medium text-danger hover:bg-danger-soft"
                >
                  {t('ยกเลิก')}
                </button>
              )}
            </div>
          ),
      },
    )
    return list
    // doVoid closes over the toast/confirm helpers, which are stable for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, locationId, stockCardMode, balances, isAdmin, locationById])

  return (
    <div className="space-y-4">
      <PageHeader
        icon="history"
        title={t("ประวัติ / Stock Card")}
        subtitle={t('ทุกการเคลื่อนไหวถูกบันทึกถาวร — เลือกสินค้า + คลัง เพื่อดูยอดคงเหลือแบบ Stock Card')}
      />

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
          <p className="mt-2 text-xs text-in">
            <Icon name="info" size={16} className="mt-0.5 shrink-0" />
            <span>{t("โหมด Stock Card: แสดงยอดคงเหลือสะสมของสินค้านี้ที่คลังที่เลือก")}</span>
          </p>
        )}
      </Card>

      <LedgerWindowNotice />

      <Card className="overflow-hidden">
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(m) => m.id}
          minWidth={stockCardMode ? 820 : 720}
          maxHeight="calc(100vh - 260px)"
          rowClassName={(m) => (m.voided ? 'bg-sunken text-ink-faint' : '')}
          empty={<EmptyState icon="history" title={t('ไม่พบรายการ')} hint={t('ลองปรับตัวกรอง')} />}
          cardActions={(m) =>
            m.voided ? null : (
              <>
                <Button variant="secondary" onClick={() => setEditing(m)}>
                  {t('แก้ไข')}
                </Button>
                {isAdmin && (
                  <Button variant="danger" onClick={() => doVoid(m)}>
                    {t('ยกเลิก')}
                  </Button>
                )}
              </>
            )
          }
        />
      </Card>

      {editing && <EditMovementModal movement={editing} onClose={() => setEditing(null)} />}
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
        <div className="p-6 text-center text-sm text-ink-faint">{t("กำลังโหลด...")}</div>
      ) : url ? (
        <img src={url} alt={t('หลักฐาน')} className="mx-auto max-h-[70vh] rounded-lg" />
      ) : (
        <div className="p-6 text-center text-sm text-ink-faint">{t("ไม่พบรูป")}</div>
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
                  {e.changed.length > 0 && ` (${e.changed.map((c) => t(c)).join(', ')})`}
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

/** Effect of a movement on a specific location's balance. */
