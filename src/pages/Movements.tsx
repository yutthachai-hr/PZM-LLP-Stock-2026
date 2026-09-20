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
import { voidMovement, getMovementImage } from '../services/stock'
import { EditMovementModal } from '../components/movements/EditMovementModal'
import { TYPE_COLOR, TYPE_LABEL } from '../components/movements/labels'
import { SiteChip, SiteSelect } from '../components/SiteChip'
import { fmtQty, formatThaiDate, dateInputToMs, dayRange } from '../lib/format'
import { effectAt, effectOverall, stockCard } from '../lib/ledger'
import { breakdown, describeQty } from '../lib/uom'
import { ADJUST_REASONS, type MovementType, type StockMovement } from '../types'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'

export function MovementsPage() {
  const t = useT()
  const { movements, locations, products, productById, ensureMovementsFrom } = useData()
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
          <span className="inline-flex flex-wrap items-center gap-1">
            <SiteChip locationId={m.fromLocationId} />
            {m.fromLocationId && m.toLocationId && (
              <Icon name="arrowRight" size={12} className="inline align-middle" />
            )}
            <SiteChip locationId={m.toLocationId} />
          </span>
        ),
      },
      {
        key: 'qty',
        header: t('จำนวน'),
        align: 'right',
        className: 'num font-semibold',
        cell: (m) => {
          // With no site chosen a transfer nets to nothing for the company, and the list
          // used to print "0" for it — which read as a bug (owner, 20 Sep 2026). The list
          // says what moved; the sign belongs to a site's own stock card.
          if (!locationId && m.fromLocationId && m.toLocationId) {
            return (
              <span className="text-ink">{describeQty(m, fmtQty)}</span>
            )
          }
          const eff = locationId ? effectAt(m, locationId) : effectOverall(m)
          return (
            <span className={eff < 0 ? 'text-out' : 'text-in'}>
              {eff > 0 ? '+' : eff < 0 ? '−' : ''}
              {describeQty(m, fmtQty)}
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
        cell: (m) => {
          const bal = balances.get(m.id) ?? 0
          const p = productById(m.productId)
          const more = p?.unitConversions?.length ? breakdown(bal, p, fmtQty) : ''
          return (
            <>
              {fmtQty(bal)}
              {more && <span className="ml-1 text-xs font-normal text-ink-faint">(= {more})</span>}
            </>
          )
        },
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
  }, [t, locationId, stockCardMode, balances, isAdmin, productById])

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
            <SiteSelect value={locationId} onChange={setLocationId} locations={locations} emptyLabel={t("ทุกคลัง")} />
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

/** Effect of a movement on a specific location's balance. */
