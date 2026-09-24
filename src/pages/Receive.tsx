import { useEffect, useMemo, useState } from 'react'
import { SiteSelect } from '../components/SiteChip'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Button, Field, Input } from '../components/ui'
import { FramePage, PageHero, SectionCard, WithSidePanel } from '../components/frame'
import { KeyingSide } from '../components/keying/KeyingSide'
import { SubmitBar } from '../components/keying/SubmitBar'
import { Icon } from '../components/Icon'
import { receiveStock } from '../services/stock'
import { dateInputToMs, msToDateInput, todayMs } from '../lib/format'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import { useDraft } from '../lib/useDraft'
import { DraftNotice } from '../components/DraftNotice'
import { BillCard } from './receive/BillCard'
import { emptyBill, planBills, restoreBills, type Bill, type BillProblem } from './receive/bills'

/**
 * รับสินค้าเข้า in the 22 Sep frame (spec §2.3 — built on mock-up 03's shape, which has no
 * receive screen of its own): the receipt's details, its lines as a table, the commit bar,
 * and the day's receipts beside it.
 *
 * Who received is whoever is signed in — the mock-up's dropdown of people is not offered,
 * because the person on a movement is the account that filed it (the anti-fraud rule).
 *
 * Several bills at once (owner, 24 Sep 2026): the site and the day are shared, each
 * supplier's bill is a card of its own, and a save files one RC- document per bill with
 * the bill's number as its note — the same documents saving them one by one produced.
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
  const [bills, setBills] = useState<Bill[]>(() => [emptyBill()])
  // Which card's bill number takes the cursor, and a counter to make it happen again: a new
  // card, and after a save, because the next thing anyone does is pick up the next bill.
  const [focus, setFocus] = useState<{ id: string; n: number }>({ id: '', n: 0 })
  const [busy, setBusy] = useState(false)

  // Half-keyed bills survive leaving the screen (lib/useDraft.ts). A draft saved before this
  // screen had bills comes back as the first one (receive/bills.ts).
  const draft = useMemo(() => ({ toLocationId, dateStr, bills }), [toLocationId, dateStr, bills])
  const isEmpty = (d: typeof draft) => d.bills.every((b) => b.lines.length === 0 && !b.note.trim())
  const { restored, clear: clearDraft } = useDraft(
    'receive',
    draft,
    (d) => {
      if (d.toLocationId) setToLocationId(d.toLocationId)
      if (d.dateStr) setDateStr(d.dateStr)
      setBills(restoreBills(d))
    },
    isEmpty,
  )
  function discardDraft() {
    setBills([emptyBill()])
    clearDraft()
  }

  // set the default warehouse once locations have loaded
  useEffect(() => {
    if (!toLocationId && defaultWh) setToLocationId(defaultWh.id)
  }, [toLocationId, defaultWh])

  function updateBill(id: string, next: Bill) {
    setBills((cur) => cur.map((b) => (b.id === id ? next : b)))
  }
  function removeBill(id: string) {
    setBills((cur) => (cur.length > 1 ? cur.filter((b) => b.id !== id) : cur))
  }
  function addBill() {
    const b = emptyBill()
    setBills((cur) => [...cur, b])
    setFocus((f) => ({ id: b.id, n: f.n + 1 }))
  }

  async function submit() {
    if (!toLocationId) return toast.error(t('เลือกคลังปลายทาง'))
    const plan = planBills(bills)
    if (!plan.ok) return toast.error(billProblem(plan.reason, plan.index + 1))
    setBusy(true)
    const filed: string[] = []
    try {
      for (const b of plan.bills) {
        const docNo = await receiveStock({
          lines: b.lines,
          toLocationId,
          date: dateInputToMs(dateStr),
          actor: { id: user!.id, name: user!.name },
          note: b.note,
        })
        filed.push(docNo)
        // Off the screen the moment it is filed: if a later bill fails, pressing save again
        // must not file this one twice.
        setBills((cur) => {
          const rest = cur.filter((x) => x.id !== b.id)
          return rest.length ? rest : [emptyBill()]
        })
      }
      toast.success(
        filed.length === 1
          ? t('รับสินค้าเข้าเรียบร้อย (เลขที่ {docNo})', { docNo: filed[0] })
          : t('รับเข้าแล้ว {n} บิล: {docs}', { n: filed.length, docs: filed.join(', ') }),
      )
      const fresh = emptyBill()
      setBills([fresh])
      setFocus((f) => ({ id: fresh.id, n: f.n + 1 }))
      clearDraft()
    } catch (e) {
      const failed = plan.bills[filed.length]
      const n = bills.findIndex((x) => x.id === failed?.id) + 1
      const done = filed.length ? ' ' + t('(บันทึกแล้ว {n} บิล: {docs})', { n: filed.length, docs: filed.join(', ') }) : ''
      toast.error(t('บิล {n} บันทึกไม่สำเร็จ:', { n }) + ' ' + errText(e, t) + done)
    } finally {
      setBusy(false)
    }
  }

  // Each refusal names the card, so a stack of five bills is not searched by eye.
  function billProblem(reason: BillProblem, n: number): string {
    switch (reason) {
      case 'noNote':
        return t('บิล {n}: กรุณากรอกเลขบิล/เอกสารส่งของจาก Supplier', { n })
      case 'noLines':
        return t('บิล {n}: ยังไม่มีรายการสินค้า', { n })
      case 'badQty':
        return t('บิล {n}: จำนวนต้องมากกว่า 0', { n })
      case 'nothing':
        return t('เพิ่มรายการสินค้าก่อน')
    }
  }

  const day = dateInputToMs(dateStr)
  const lineCount = bills.reduce((n, b) => n + b.lines.length, 0)
  const billCount = bills.filter((b) => b.lines.length > 0).length

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
                <li>{t('หลายเจ้าในวันเดียว: กด "เพิ่มบิล" แยกบิลละกล่อง บันทึกครั้งเดียวได้ทุกบิล')}</li>
                <li>{t('คีย์เป็นหน่วยที่อยู่บนบิลได้เลย ระบบแปลงเป็นหน่วยหลักให้')}</li>
                <li>{t('คีย์ผิดแก้ได้จากรายการวันนี้ด้านบน — ยอดคงเหลือปรับตามอัตโนมัติ')}</li>
              </ul>
            }
          />
        }
      >
        {restored && <DraftNotice onDiscard={discardDraft} />}

        <SectionCard icon="receive" title={t('ข้อมูลการรับ')}>
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
          </div>
        </SectionCard>

        {bills.map((b, i) => (
          <BillCard
            key={b.id}
            index={i}
            bill={b}
            onChange={(next) => updateBill(b.id, next)}
            onRemove={bills.length > 1 ? () => removeBill(b.id) : undefined}
            focusNote={focus.id === b.id ? focus.n : undefined}
            products={products}
            onHandAt={toLocationId ? (id) => qtyAt(toLocationId, id) : undefined}
          />
        ))}

        <button
          type="button"
          onClick={addBill}
          className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-surface text-sm font-medium text-ink-soft outline-none transition-colors duration-150 hover:border-brand hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <Icon name="plus" size={18} />
          {t('เพิ่มบิล')}
        </button>

        <SubmitBar hasDraft={!isEmpty(draft)}>
          <Button onClick={submit} disabled={busy || lineCount === 0} variant="success" className="w-full sm:w-auto sm:min-w-64">
            <Icon name="check" size={18} />
            {busy
              ? t('กำลังบันทึก...')
              : billCount > 1
                ? t('บันทึกรับเข้า {bills} บิล ({n} รายการ)', { bills: billCount, n: lineCount })
                : t('บันทึกรับเข้า ({n} รายการ)', { n: lineCount })}
          </Button>
        </SubmitBar>
      </WithSidePanel>
    </FramePage>
  )
}
