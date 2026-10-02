import { useEffect, useMemo, useRef, useState } from 'react'
import { SiteSelect } from '../../components/SiteChip'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/Confirm'
import { Icon } from '../../components/Icon'
import { Badge, Button, Card, Field, SectionHeader } from '../../components/ui'
import { PageHero } from '../../components/frame'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { formatThaiDate } from '../../lib/format'
import { createBatch, findBatchesByHash } from '../../services/purchaseBatch'
import type { PurchaseBatch } from '../../types'
import { remember, remembered, useWorkbookRows } from './useWorkbookRows'
import { WorkbookCounts, WorkbookMapping, WorkbookRound, WorkbookTable } from './WorkbookRows'

/**
 * "นำเข้ารายการสั่งซื้อจาก Excel": the order workbook in, a batch out.
 *
 * Three steps on one screen — the file, which day and which warehouse, the preview — and
 * one button at the end. The preview is the whole point: every row is shown with what the
 * app made of it, and nothing becomes a batch until the person has seen that. A row the
 * app could not settle is a question, settled right here or on the batch page after; it is
 * never quietly dropped and never quietly guessed.
 */

const LS_LOCATION = 'pmstock:purchase:locationId'
/** The answers given on the preview, per file and order round, kept until the batch is made. */
const LS_EDITS = 'pmstock:purchase:edits:'

export function PurchaseImportPage() {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { locations } = useData()
  const wb = useWorkbookRows(LS_EDITS)
  const fileRef = useRef<HTMLInputElement>(null)

  const [priorBatches, setPriorBatches] = useState<PurchaseBatch[]>([])
  const [locationId, setLocationId] = useState(() => remembered<string>(LS_LOCATION) ?? '')
  const [busy, setBusy] = useState(false)

  const activeLocations = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  useEffect(() => {
    if (!locationId && activeLocations.length > 0) {
      setLocationId(activeLocations.find((l) => l.type === 'warehouse')?.id ?? activeLocations[0].id)
    }
  }, [activeLocations, locationId])

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const hash = await wb.pickFile(file)
    if (!hash) return
    try {
      setPriorBatches(await findBatchesByHash(hash))
    } catch (err) {
      toast.error(errText(err, t))
    }
  }

  async function create() {
    const { block, rows } = wb
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
        sourceFileName: wb.fileName,
        fileHash: wb.fileHash,
        sheetName: block.sheet,
        blockLabel: block.label,
        blockDate: block.date,
        ...(wb.mapping ? { mapping: wb.mapping } : {}),
        rows,
        actor: { id: user.id, name: user.name },
      })
      wb.clearEdits()
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
      <PageHero
        icon="upload"
        title={t('นำเข้ารายการสั่งซื้อจาก Excel')}
        subtitle={t('เลือกไฟล์รายการสั่งของ ระบบจับคู่สินค้ากับผู้ขายให้ แล้วสร้างร่างใบสั่งซื้อแยกตามผู้ขาย')}
        actions={
          <Button variant="secondary" onClick={() => navigate('/purchase')}>
            {t('ชุดที่นำเข้าแล้ว')}
          </Button>
        }
      />

      {wb.error ? <Card className="p-4 text-sm text-danger">{errText(wb.error, t)}</Card> : null}

      {/* ---- 1. the file ---- */}
      <Card className="p-4">
        <SectionHeader
          icon="upload"
          title={t('1. เลือกไฟล์')}
          description={t('ไฟล์ .xlsx / .xls ที่มีคอลัมน์ ชื่อวัตถุดิบ · หน่วย · จำนวนสั่ง')}
          badge={wb.fileName ? <Badge color="green">{wb.fileName}</Badge> : undefined}
        />
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={pickFile} />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => fileRef.current?.click()} disabled={busy || wb.reading || wb.loading}>
            <Icon name="upload" size={16} />
            {wb.fileName ? t('เลือกไฟล์อื่น') : t('เลือกไฟล์ Excel')}
          </Button>
          {wb.loading && <span className="text-xs text-ink-soft">{t('กำลังโหลดข้อมูลผู้ขาย…')}</span>}
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
      {wb.fileLoaded && wb.needsMapping && (
        <Card className="p-4">
          <SectionHeader
            icon="swap"
            title={t('ไม่พบหัวตารางที่รู้จัก — ระบุคอลัมน์เอง')}
            description={t('พิมพ์ตัวอักษรคอลัมน์ใน Excel เช่น A, C, EF — จะจำไว้ให้ครั้งถัดไป')}
          />
          <WorkbookMapping wb={wb} />
        </Card>
      )}

      {/* ---- 2. which day, which warehouse ---- */}
      {wb.blocks.length > 0 && (
        <Card className="p-4">
          <SectionHeader icon="calendar" title={t('2. รอบสั่งและคลังปลายทาง')} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('รอบสั่งในไฟล์')}>
              <WorkbookRound wb={wb} />
            </Field>
            <Field label={t('คลังปลายทาง')} required>
              <SiteSelect value={locationId} onChange={setLocationId} locations={activeLocations} />
            </Field>
          </div>
        </Card>
      )}

      {/* ---- 3. the preview ---- */}
      {wb.block && (
        <Card className="p-4">
          <SectionHeader
            icon="search"
            title={t('3. ตรวจก่อนสร้าง')}
            description={t('กด "ตรวจ" ที่แถวสีเหลืองเพื่อเลือกสินค้า ผู้ขาย จำนวน หรือหน่วยได้ที่นี่เลย — ชื่อที่ยืนยันแล้วระบบจำไว้ ครั้งหน้าไม่ถามซ้ำ ระบบไม่เดาให้เอง')}
            badge={<WorkbookCounts wb={wb} />}
          />
          <WorkbookTable wb={wb} />
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button onClick={() => void create()} disabled={busy || !wb.rows || wb.rows.length === 0 || !locationId}>
              <Icon name="check" size={16} />
              {busy ? t('กำลังบันทึก...') : t('สร้างชุดสั่งซื้อ ({n} รายการ)', { n: wb.rows?.length ?? 0 })}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
