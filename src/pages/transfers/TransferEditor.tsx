import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { Icon } from '../../components/Icon'
import { SiteSelect } from '../../components/SiteChip'
import { Button, Field, Input, Textarea } from '../../components/ui'
import { FramePage, PageHero, SectionCard } from '../../components/frame'
import { LineBuilder, type Line } from '../../components/LineBuilder'
import { SubmitBar } from '../../components/keying/SubmitBar'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { dateInputToMs, msToDateInput, todayMs } from '../../lib/format'
import { createDraft, submitTransfer } from '../../services/transfers'
import type { Transfer, TransferItem } from '../../types'

interface TransferEditorProps {
  initial: Transfer | null
  onChange: (t: Transfer) => void
}

export function TransferEditor({ initial, onChange }: TransferEditorProps) {
  const t = useT()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const { products, productById, locations, qtyAt } = useData()

  const activeLocations = useMemo(
    () => locations.filter((l) => l.active !== false && l.type !== 'transit'),
    [locations],
  )
  const defaultWarehouse =
    activeLocations.find((l) => l.type === 'warehouse') ?? activeLocations[0]

  const [fromLocationId, setFromLocationId] = useState(
    initial?.fromLocationId ?? defaultWarehouse?.id ?? '',
  )
  const [toLocationId, setToLocationId] = useState(initial?.toLocationId ?? '')
  const [dateStr, setDateStr] = useState(
    msToDateInput(initial?.dispatchDate ?? todayMs()),
  )
  const [note, setNote] = useState(initial?.note ?? '')
  const [lines, setLines] = useState<Line[]>(() =>
    (initial?.items ?? []).map((i) => ({
      productId: i.productId,
      productName: i.productName,
      unit: i.unit,
      qty: i.requestedQty ?? i.dispatchQty ?? 0,
    })),
  )
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!toLocationId && activeLocations.length > 1) {
      const branch = activeLocations.find(
        (l) => l.type === 'branch' && l.id !== fromLocationId,
      )
      if (branch) setToLocationId(branch.id)
    }
  }, [toLocationId, activeLocations, fromLocationId])

  const availableAt = (productId: string) => qtyAt(fromLocationId, productId)

  function validate(): boolean {
    if (!fromLocationId || !toLocationId) {
      toast.error(t('เลือกต้นทางและปลายทาง'))
      return false
    }
    if (fromLocationId === toLocationId) {
      toast.error(t('ต้นทางและปลายทางต้องต่างกัน'))
      return false
    }
    if (lines.length === 0) {
      toast.error(t('เพิ่มรายการสินค้าก่อน'))
      return false
    }
    if (lines.some((l) => !(l.qty > 0))) {
      toast.error(t('จำนวนต้องมากกว่า 0'))
      return false
    }
    const over = lines.find((l) => l.qty > availableAt(l.productId))
    if (over) {
      toast.error(t('สต๊อกไม่พอสำหรับ "{name}"', { name: over.productName }))
      return false
    }
    return true
  }

  async function handleSaveDraft() {
    if (!fromLocationId || !toLocationId) return toast.error(t('เลือกต้นทางและปลายทาง'))
    if (fromLocationId === toLocationId) return toast.error(t('ต้นทางและปลายทางต้องต่างกัน'))
    setBusy(true)
    try {
      const actor = {
        id: user!.id,
        name: user!.name,
        role: user!.role,
        siteIds: user!.siteIds,
      }
      let current = initial
      if (!current) {
        current = await createDraft({
          fromLocationId,
          toLocationId,
          dispatchDate: dateInputToMs(dateStr),
          note: note.trim() || undefined,
          actor,
        })
      }
      toast.success(t('บันทึกร่างเรียบร้อย ({docNo})', { docNo: current.docNo }))
      onChange(current)
      navigate(`/transfers/${current.id}`)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit() {
    if (!validate()) return
    setBusy(true)
    try {
      const actor = {
        id: user!.id,
        name: user!.name,
        role: user!.role,
        siteIds: user!.siteIds,
      }

      let targetId = initial?.id
      if (!targetId) {
        const draft = await createDraft({
          fromLocationId,
          toLocationId,
          dispatchDate: dateInputToMs(dateStr),
          note: note.trim() || undefined,
          actor,
        })
        targetId = draft.id
      }

      const items: TransferItem[] = lines.map((l, idx) => ({
        idx,
        productId: l.productId,
        productName: l.productName,
        sku: productById(l.productId)?.sku ?? '',
        unit: l.unit,
        requestedQty: l.qty,
        dispatchQty: l.qty,
      }))

      const submitted = await submitTransfer(targetId, actor, items)
      toast.success(t('ส่งคำขอโอนสินค้าเรียบร้อย ({docNo})', { docNo: submitted.docNo }))
      onChange(submitted)
      navigate(`/transfers/${submitted.id}`)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FramePage>
      <PageHero
        icon="swap"
        tone="brand"
        title={initial ? t('แก้ไขคำขอโอน ({docNo})', { docNo: initial.docNo }) : t('สร้างคำขอโอนสินค้า')}
        subtitle={t('เลือกสาขาต้นทาง ปลายทาง และระบุสินค้าที่ต้องการโอน')}
      />

      <div className="mx-auto max-w-4xl space-y-4">
        <SectionCard icon="note" title={t('ข้อมูลเส้นทางและกำหนดการ')}>
          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 md:gap-3">
              <Field label={t('จากคลัง / สาขา (ต้นทาง)')} required>
                <SiteSelect
                  value={fromLocationId}
                  onChange={setFromLocationId}
                  locations={activeLocations}
                />
              </Field>
              <span
                className="mb-1.5 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-sunken text-ink-soft md:h-9 md:w-9"
                aria-hidden
              >
                <Icon name="arrowRight" size={16} />
              </span>
              <Field label={t('ไปยังสาขา (ปลายทาง)')} required>
                <SiteSelect
                  value={toLocationId}
                  onChange={setToLocationId}
                  locations={activeLocations.filter((l) => l.id !== fromLocationId)}
                  emptyLabel={t('— เลือก —')}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
              <Field label={t('วันที่ขนส่ง')} required>
                <Input
                  type="date"
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                />
              </Field>
              <Field label={t('ผู้ทำรายการ')}>
                <Input value={user?.name ?? ''} disabled />
              </Field>
              <Field label={t('หมายเหตุ')} className="md:col-span-1">
                <Textarea
                  rows={1}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('ระบุหมายเหตุ (ถ้ามี)')}
                />
              </Field>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          icon="package"
          title={t('รายการสินค้าที่ต้องการโอน')}
          count={lines.length ? t('({n} รายการ)', { n: lines.length }) : undefined}
        >
          <LineBuilder
            products={products}
            lines={lines}
            onChange={setLines}
            availableAt={availableAt}
            direction="out"
            lineNotes
          />
        </SectionCard>

        <SubmitBar hasDraft={lines.length > 0}>
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <Button
              variant="outline"
              onClick={handleSaveDraft}
              disabled={busy}
              className="w-full sm:w-auto"
            >
              {t('บันทึกร่าง')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={busy || lines.length === 0}
              className="w-full sm:w-auto sm:min-w-64"
            >
              <Icon name="check" size={18} />
              {busy
                ? t('กำลังบันทึก...')
                : t('ส่งคำขอโอนสินค้า ({n} รายการ)', { n: lines.length })}
            </Button>
          </div>
        </SubmitBar>
      </div>
    </FramePage>
  )
}
