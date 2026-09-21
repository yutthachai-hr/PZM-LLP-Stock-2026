import { useEffect, useMemo, useState } from 'react'
import { SiteSelect } from '../components/SiteChip'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Button, Card, Field, FormActions, Input, PageHeader, Textarea } from '../components/ui'
import { LineBuilder, type Line } from '../components/LineBuilder'
import { TodayTransactions, WithTodayPanel } from '../components/movements/TodayTransactions'
import { receiveStock } from '../services/stock'
import { dateInputToMs, msToDateInput, todayMs } from '../lib/format'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import { useDraft } from '../lib/useDraft'
import { DraftNotice } from '../components/DraftNotice'

export function ReceivePage() {
  const t = useT()
  const { products, locations } = useData()
  const { user } = useAuth()
  const toast = useToast()

  const warehouses = useMemo(
    () => locations.filter((l) => l.active !== false),
    [locations],
  )
  const defaultWh = warehouses.find((l) => l.type === 'warehouse') ?? warehouses[0]

  const [toLocationId, setToLocationId] = useState(defaultWh?.id ?? '')
  const [dateStr, setDateStr] = useState(msToDateInput(todayMs()))
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  // Raised after a save so the cursor lands back in the product search: the next thing
  // anyone does with a delivery note is key the next line off it.
  const [focusOn, setFocusOn] = useState(0)

  const [busy, setBusy] = useState(false)

  // Half-keyed notes survive leaving the screen (lib/useDraft.ts).
  const draft = useMemo(() => ({ toLocationId, dateStr, note, lines }), [toLocationId, dateStr, note, lines])
  const { restored, clear: clearDraft } = useDraft(
    'receive',
    draft,
    (d) => {
      if (d.toLocationId) setToLocationId(d.toLocationId)
      if (d.dateStr) setDateStr(d.dateStr)
      setNote(d.note ?? '')
      setLines(Array.isArray(d.lines) ? d.lines : [])
    },
    (d) => d.lines.length === 0 && !d.note.trim(),
  )
  function discardDraft() {
    setLines([])
    setNote('')
    clearDraft()
  }

  // set the default warehouse once locations have loaded
  useEffect(() => {
    if (!toLocationId && defaultWh) setToLocationId(defaultWh.id)
  }, [toLocationId, defaultWh])

  async function submit() {
    if (!toLocationId) return toast.error(t("เลือกคลังปลายทาง"))
    if (lines.length === 0) return toast.error(t("เพิ่มรายการสินค้าก่อน"))
    if (lines.some((l) => !(l.qty > 0))) return toast.error(t("จำนวนต้องมากกว่า 0"))
    if (!note.trim()) return toast.error(t("กรุณากรอกเลขบิล/เอกสารส่งของจาก Supplier"))
    setBusy(true)
    try {
      const docNo = await receiveStock({
        lines,
        toLocationId,
        date: dateInputToMs(dateStr),
        actor: { id: user!.id, name: user!.name },
        note: note.trim(),
      })
      toast.success(t('รับสินค้าเข้าเรียบร้อย (เลขที่ {docNo})', { docNo }))
      setLines([])
      setFocusOn((n) => n + 1)
      setNote('')
      clearDraft()
    } catch (e) {
      toast.error(t("บันทึกไม่สำเร็จ:") + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        icon="receive"
        tone="in"
        title={t("รับสินค้าเข้า")}
        subtitle={t("คีย์รับสินค้าใหม่ → เพิ่มเข้าคลังอัตโนมัติ")}
      />

      <WithTodayPanel panel={<TodayTransactions types={['receive']} date={dateInputToMs(dateStr)} title={t('รับเข้าที่ทำวันนี้')} />}>
      {restored && <DraftNotice onDiscard={discardDraft} />}
      <Card className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("คลังปลายทาง")} required>
            <SiteSelect value={toLocationId} onChange={setToLocationId} locations={warehouses} />
          </Field>
          <Field label={t("วันที่รับ")} required>
            <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
          <Field label={t("ผู้รับเข้า (บันทึกอัตโนมัติ)")}>
            <Input value={user?.name ?? ''} disabled />
          </Field>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-ink">{t("รายการสินค้า")}</div>
          <LineBuilder
            products={products}
            lines={lines}
            onChange={setLines}
            direction="in"
            focusOn={focusOn}
          />
        </div>

        <Field
          label={t("หมายเหตุ / เลขบิลส่งของ (Supplier)")}
          required
          hint={t("ระบุเลขเอกสารจริงจาก Supplier — เช่น เดล ตาซาโร (ประเทศไทย) จำกัด · Bocconcini 4.5 kg · เลขบิล IV2616876")}
        >
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("เช่น เดล ตาซาโร (ประเทศไทย) จำกัด / เลขบิล IV2616876")}
          />
        </Field>

        <FormActions>
          <Button onClick={submit} disabled={busy || lines.length === 0} variant="success">
            {busy ? t("กำลังบันทึก...") : t('บันทึกรับเข้า ({n} รายการ)', { n: lines.length })}
          </Button>
        </FormActions>
      </Card>
      </WithTodayPanel>
    </div>
  )
}
