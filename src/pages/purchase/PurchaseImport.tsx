import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/Confirm'
import { Icon } from '../../components/Icon'
import { Badge, Button, Card, Field, Input, PageHeader, SectionHeader, Select, Spinner } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { fmtQty, formatThaiDate } from '../../lib/format'
import {
  defaultBlock,
  parseOrderWorkbook,
  type ColumnMapping,
  type OrderBlock,
} from '../../lib/orderSheet'
import {
  assessRows,
  buildBatchRows,
  createBatch,
  findBatchesByHash,
  hashFile,
  rowState,
} from '../../services/purchaseBatch'
import type { BatchRow, PurchaseBatch } from '../../types'
import { badgeColor, issueText, rowStateText } from './issues'
import { useAssessContext } from './useAssessContext'

/**
 * "นำเข้ารายการสั่งซื้อจาก Excel": the order workbook in, a batch out.
 *
 * Three steps on one screen — the file, which day and which warehouse, the preview — and
 * one button at the end. The preview is the whole point: every row is shown with what the
 * app made of it, and nothing becomes a batch until the person has seen that. A row the
 * app could not settle is shown as a question here and stays a question on the review
 * screen; it is never quietly dropped and never quietly guessed.
 */

const LS_LOCATION = 'pmstock:purchase:locationId'
const LS_MAPPING = 'pmstock:purchase:mapping'

function remembered<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function remember(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // A device that refuses storage just asks again next time.
  }
}

export function PurchaseImportPage() {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { products, locations } = useData()
  const { ctx, aliases, loading: ctxLoading, error: ctxError } = useAssessContext()
  const fileRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState('')
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null)
  const [fileHash, setFileHash] = useState('')
  const [priorBatches, setPriorBatches] = useState<PurchaseBatch[]>([])
  const [blocks, setBlocks] = useState<OrderBlock[]>([])
  const [blockIdx, setBlockIdx] = useState(0)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [mappingForm, setMappingForm] = useState<ColumnMapping>(
    () => remembered<ColumnMapping>(LS_MAPPING) ?? { name: 'A', qty: 'C', unit: 'B', note: '' },
  )
  const [needsMapping, setNeedsMapping] = useState(false)
  const [locationId, setLocationId] = useState(() => remembered<string>(LS_LOCATION) ?? '')
  const [busy, setBusy] = useState(false)

  const activeLocations = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  useEffect(() => {
    if (!locationId && activeLocations.length > 0) {
      setLocationId(activeLocations.find((l) => l.type === 'warehouse')?.id ?? activeLocations[0].id)
    }
  }, [activeLocations, locationId])

  const block = blocks[blockIdx] ?? null

  /** The rows as the batch would hold them — built and judged the same way the batch does. */
  const rows = useMemo<BatchRow[] | null>(() => {
    if (!block || !ctx) return null
    return assessRows(buildBatchRows(block, products, aliases), ctx)
  }, [block, ctx, products, aliases])

  const counts = useMemo(() => {
    const c = { ready: 0, review: 0, blocked: 0, skipped: 0 }
    for (const r of rows ?? []) c[rowState(r)]++
    return c
  }, [rows])

  function parse(bytes: ArrayBuffer, map: ColumnMapping | null) {
    const parsed = parseOrderWorkbook(bytes, map ?? undefined)
    setBlocks(parsed.blocks)
    const def = defaultBlock(parsed.blocks)
    setBlockIdx(def ? parsed.blocks.indexOf(def) : 0)
    setNeedsMapping(parsed.blocks.length === 0)
  }

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/\.xlsx?$/i.test(file.name)) {
      toast.error(t('อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ Excel (.xlsx หรือ .xls)'))
      return
    }
    setBusy(true)
    try {
      const bytes = await file.arrayBuffer()
      setFileName(file.name)
      setFileBytes(bytes)
      setMapping(null)
      parse(bytes, null)
      const hash = await hashFile(bytes)
      setFileHash(hash)
      setPriorBatches(await findBatchesByHash(hash))
    } catch (err) {
      toast.error(errText(err, t))
    } finally {
      setBusy(false)
    }
  }

  function applyMapping() {
    if (!fileBytes) return
    const map: ColumnMapping = {
      name: mappingForm.name.trim(),
      qty: mappingForm.qty.trim(),
      ...(mappingForm.unit?.trim() ? { unit: mappingForm.unit.trim() } : {}),
      ...(mappingForm.note?.trim() ? { note: mappingForm.note.trim() } : {}),
    }
    setMapping(map)
    remember(LS_MAPPING, map)
    parse(fileBytes, map)
  }

  async function create() {
    if (!block || !rows || !user) return
    if (priorBatches.length > 0) {
      const ok = await confirm({
        title: t('ไฟล์นี้เคยนำเข้าแล้ว'),
        message: t('ไฟล์เดียวกันนี้เคยนำเข้าเป็น {list} — นำเข้าอีกครั้งจะได้ชุดใหม่แยกต่างหาก และอาจสั่งของซ้ำ', {
          list: priorBatches.map((b) => b.batchNo).join(', '),
        }),
        danger: true,
        confirmText: t('นำเข้าอีกครั้ง'),
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      remember(LS_LOCATION, locationId)
      const batch = await createBatch({
        locationId,
        sourceFileName: fileName,
        fileHash,
        sheetName: block.sheet,
        blockLabel: block.label,
        blockDate: block.date,
        ...(mapping ? { mapping } : {}),
        rows,
        actor: { id: user.id, name: user.name },
      })
      toast.success(t('สร้างชุด {no} แล้ว', { no: batch.batchNo }))
      navigate(`/purchase/${batch.id}`)
    } catch (err) {
      toast.error(errText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon="upload"
        title={t('นำเข้ารายการสั่งซื้อจาก Excel')}
        subtitle={t('เลือกไฟล์รายการสั่งของ ระบบจับคู่สินค้ากับผู้ขายให้ แล้วสร้างร่างใบสั่งซื้อแยกตามผู้ขาย')}
        actions={
          <Button variant="secondary" onClick={() => navigate('/purchase')}>
            {t('ชุดที่นำเข้าแล้ว')}
          </Button>
        }
      />

      {ctxError ? (
        <Card className="p-4 text-sm text-danger">{errText(ctxError, t)}</Card>
      ) : null}

      {/* ---- 1. the file ---- */}
      <Card className="p-4">
        <SectionHeader
          icon="upload"
          title={t('1. เลือกไฟล์')}
          description={t('ไฟล์ .xlsx / .xls ที่มีคอลัมน์ ชื่อวัตถุดิบ · หน่วย · จำนวนสั่ง')}
          badge={fileName ? <Badge color="green">{fileName}</Badge> : undefined}
        />
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={pickFile} />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => fileRef.current?.click()} disabled={busy || ctxLoading}>
            <Icon name="upload" size={16} />
            {fileName ? t('เลือกไฟล์อื่น') : t('เลือกไฟล์ Excel')}
          </Button>
          {ctxLoading && <span className="text-xs text-ink-soft">{t('กำลังโหลดข้อมูลผู้ขาย…')}</span>}
        </div>
        {priorBatches.length > 0 && (
          <div className="mt-3 rounded-lg bg-warn-soft p-3 text-sm text-warn">
            <Icon name="warning" size={16} className="mr-1 inline" />
            {t('ไฟล์นี้เคยนำเข้าแล้วเป็น {list} — ตรวจก่อนว่าไม่ได้สั่งซ้ำ', {
              list: priorBatches.map((b) => `${b.batchNo} (${formatThaiDate(b.createdAt)})`).join(', '),
            })}
          </div>
        )}
      </Card>

      {/* ---- 1b. columns, when the headers said nothing ---- */}
      {fileBytes && needsMapping && (
        <Card className="p-4">
          <SectionHeader
            icon="swap"
            title={t('ไม่พบหัวตารางที่รู้จัก — ระบุคอลัมน์เอง')}
            description={t('พิมพ์ตัวอักษรคอลัมน์ใน Excel เช่น A, C, EF — จะจำไว้ให้ครั้งถัดไป')}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label={t('ชื่อสินค้า')} required>
              <Input value={mappingForm.name} onChange={(e) => setMappingForm({ ...mappingForm, name: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={t('จำนวนสั่ง')} required>
              <Input value={mappingForm.qty} onChange={(e) => setMappingForm({ ...mappingForm, qty: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={t('หน่วย')}>
              <Input value={mappingForm.unit ?? ''} onChange={(e) => setMappingForm({ ...mappingForm, unit: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={t('หมายเหตุ / วันส่ง')}>
              <Input value={mappingForm.note ?? ''} onChange={(e) => setMappingForm({ ...mappingForm, note: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          <div className="mt-3">
            <Button onClick={applyMapping} disabled={!mappingForm.name.trim() || !mappingForm.qty.trim()}>
              {t('อ่านตามคอลัมน์นี้')}
            </Button>
          </div>
        </Card>
      )}

      {/* ---- 2. which day, which warehouse ---- */}
      {blocks.length > 0 && (
        <Card className="p-4">
          <SectionHeader icon="calendar" title={t('2. รอบสั่งและคลังปลายทาง')} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('รอบสั่งในไฟล์')}>
              <Select value={blockIdx} onChange={(e) => setBlockIdx(Number(e.target.value))}>
                {blocks.map((b, i) => (
                  <option key={`${b.sheet}-${b.headerRow}-${b.cols.name}`} value={i}>
                    {b.label}
                    {blocks.some((o) => o !== b && o.label === b.label) ? ` (${b.sheet})` : ''}
                    {' — '}
                    {t('{n} รายการสั่ง', { n: b.rows.filter((r) => r.qtyState !== 'none').length })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('คลังปลายทาง')} required>
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {activeLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
      )}

      {/* ---- 3. the preview ---- */}
      {block && (
        <Card className="p-4">
          <SectionHeader
            icon="search"
            title={t('3. ตรวจก่อนสร้าง')}
            description={t('แถวที่ระบบไม่แน่ใจจะถูกถามในหน้าถัดไป — ไม่มีการเดาผู้ขาย')}
            badge={
              rows ? (
                <span className="flex flex-wrap gap-1">
                  <Badge color="green">{t('พร้อม {n}', { n: counts.ready })}</Badge>
                  {counts.review > 0 && <Badge color="amber">{t('ต้องตรวจ {n}', { n: counts.review })}</Badge>}
                  {counts.blocked > 0 && <Badge color="red">{t('ติดปัญหา {n}', { n: counts.blocked })}</Badge>}
                </span>
              ) : undefined
            }
          />
          {!rows ? (
            <Spinner label={t('กำลังจับคู่สินค้า…')} />
          ) : rows.length === 0 ? (
            <p className="text-sm text-ink-soft">{t('รอบนี้ไม่มีแถวที่ใส่จำนวนสั่ง')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs text-ink-soft">
                  <tr>
                    <th className="py-1 pr-2">{t('แถว')}</th>
                    <th className="py-1 pr-2">{t('ในไฟล์')}</th>
                    <th className="py-1 pr-2 text-right">{t('จำนวน')}</th>
                    <th className="py-1 pr-2">{t('สินค้าในระบบ')}</th>
                    <th className="py-1 pr-2">{t('ผู้ขาย')}</th>
                    <th className="py-1">{t('สถานะ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const state = rowState(r)
                    return (
                      <tr key={r.idx} className="border-b border-line align-top">
                        <td className="num py-1.5 pr-2 text-ink-faint">{r.excelRow}</td>
                        <td className="py-1.5 pr-2 text-ink">{r.rawName}</td>
                        <td className="num whitespace-nowrap py-1.5 pr-2 text-right">
                          {r.qty !== undefined ? fmtQty(r.qty) : <span className="text-warn">{r.rawQty}</span>}{' '}
                          <span className="text-ink-soft">{r.entryUnit ?? r.unit ?? r.rawUnit}</span>
                        </td>
                        <td className="py-1.5 pr-2">
                          {r.productName ?? <span className="text-ink-faint">—</span>}
                        </td>
                        <td className="py-1.5 pr-2">{r.supplierName ?? <span className="text-ink-faint">—</span>}</td>
                        <td className="py-1.5">
                          <Badge color={badgeColor(state)}>{rowStateText(state, t)}</Badge>
                          {r.issues.length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
                              {r.issues.map((i) => (
                                <li key={i.code}>• {issueText(i, t)}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button onClick={() => void create()} disabled={busy || !rows || rows.length === 0 || !locationId}>
              <Icon name="check" size={16} />
              {busy ? t('กำลังบันทึก...') : t('สร้างชุดสั่งซื้อ ({n} รายการ)', { n: rows?.length ?? 0 })}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
