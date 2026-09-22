import { useEffect, useMemo, useState } from 'react'
import { SiteSelect } from '../components/SiteChip'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Button, Field, Input, Textarea } from '../components/ui'
import { FramePage, PageHero, SectionCard, WithSidePanel } from '../components/frame'
import { LineBuilder, type Line } from '../components/LineBuilder'
import { KeyingSide } from '../components/keying/KeyingSide'
import { SubmitBar } from '../components/keying/SubmitBar'
import { Icon } from '../components/Icon'
import { receiveStock } from '../services/stock'
import { dateInputToMs, msToDateInput, todayMs } from '../lib/format'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import { useDraft } from '../lib/useDraft'
import { DraftNotice } from '../components/DraftNotice'

/**
 * รับสินค้าเข้า in the 22 Sep frame (spec §2.3 — built on mock-up 03's shape, which has no
 * receive screen of its own): the receipt's details, its lines as a table, the commit bar,
 * and the day's receipts beside it.
 *
 * Who received is whoever is signed in — the mock-up's dropdown of people is not offered,
 * because the person on a movement is the account that filed it (the anti-fraud rule).
 */
export function ReceivePage() {
  const t = useT()
  const { products, locations, qtyAt } = useData()
  const { user } = useAuth()
  const toast = useToast()

  const warehouses = useMemo(() => locations.filter((l) => l.active !== false), [locations])
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
  const isEmpty = (d: typeof draft) => d.lines.length === 0 && !d.note.trim()
  const { restored, clear: clearDraft } = useDraft(
    'receive',
    draft,
    (d) => {
      if (d.toLocationId) setToLocationId(d.toLocationId)
      if (d.dateStr) setDateStr(d.dateStr)
      setNote(d.note ?? '')
      setLines(Array.isArray(d.lines) ? d.lines : [])
    },
    isEmpty,
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
    if (!toLocationId) return toast.error(t('เลือกคลังปลายทาง'))
    if (lines.length === 0) return toast.error(t('เพิ่มรายการสินค้าก่อน'))
    if (lines.some((l) => !(l.qty > 0))) return toast.error(t('จำนวนต้องมากกว่า 0'))
    if (!note.trim()) return toast.error(t('กรุณากรอกเลขบิล/เอกสารส่งของจาก Supplier'))
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
      toast.error(t('บันทึกไม่สำเร็จ:') + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const day = dateInputToMs(dateStr)

  return (
    <FramePage>
      <PageHero icon="receive" tone="in" title={t('รับสินค้าเข้า')} subtitle={t('คีย์รับสินค้าใหม่ → เพิ่มเข้าคลังอัตโนมัติ')} />

      <WithSidePanel
        side={
          <KeyingSide
            kind="receive"
            day={day}
            title={t('สรุปการรับวันนี้')}
            todayTitle={t('รับเข้าที่ทำวันนี้')}
            tips={
              <ul className="list-disc space-y-1 pl-4">
                <li>{t('ใส่เลขบิลจาก Supplier ทุกครั้ง เพื่อตรวจย้อนกลับได้')}</li>
                <li>{t('คีย์เป็นหน่วยที่อยู่บนบิลได้เลย ระบบแปลงเป็นหน่วยหลักให้')}</li>
                <li>{t('คีย์ผิดแก้ได้จากรายการวันนี้ด้านบน — ยอดคงเหลือปรับตามอัตโนมัติ')}</li>
              </ul>
            }
          />
        }
      >
        {restored && <DraftNotice onDiscard={discardDraft} />}

        <SectionCard icon="note" title={t('ข้อมูลการรับ')}>
          {/* Site and date share one line on a phone; who keyed it is recorded anyway. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
            <Field label={t('คลังปลายทาง')} required>
              <SiteSelect value={toLocationId} onChange={setToLocationId} locations={warehouses} />
            </Field>
            <Field label={t('วันที่รับ')} required>
              <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
            </Field>
            <Field label={t('ผู้รับเข้า (บันทึกอัตโนมัติ)')} className="hidden md:block">
              <Input value={user?.name ?? ''} disabled />
            </Field>
            <Field
              label={t('หมายเหตุ / เลขบิลส่งของ (Supplier)')}
              required
              className="col-span-2 md:col-span-3"
              hint={t('ระบุเลขเอกสารจริงจาก Supplier — เช่น เดล ตาซาโร (ประเทศไทย) จำกัด · Bocconcini 4.5 kg · เลขบิล IV2616876')}
            >
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('เช่น เดล ตาซาโร (ประเทศไทย) จำกัด / เลขบิล IV2616876')} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard icon="package" title={t('รายการสินค้า')} count={lines.length ? t('({n} รายการ)', { n: lines.length }) : undefined}>
          <LineBuilder
            products={products}
            lines={lines}
            onChange={setLines}
            direction="in"
            focusOn={focusOn}
            onHandAt={toLocationId ? (id) => qtyAt(toLocationId, id) : undefined}
            lineNotes
          />
        </SectionCard>

        <SubmitBar hasDraft={!isEmpty(draft)}>
          <Button onClick={submit} disabled={busy || lines.length === 0} variant="success" className="w-full sm:w-auto sm:min-w-64">
            <Icon name="check" size={18} />
            {busy ? t('กำลังบันทึก...') : t('บันทึกรับเข้า ({n} รายการ)', { n: lines.length })}
          </Button>
        </SubmitBar>
      </WithSidePanel>
    </FramePage>
  )
}
