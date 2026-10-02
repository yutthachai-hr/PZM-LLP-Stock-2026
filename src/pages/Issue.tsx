import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PosImportForm } from './issue/PosImport'
import { SiteSelect } from '../components/SiteChip'
import { Icon, type IconName } from '../components/Icon'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Button, Field, Input, Textarea } from '../components/ui'
import { FramePage, PageHero, SectionCard, WithSidePanel, frameCard } from '../components/frame'
import { LineBuilder, type Line } from '../components/LineBuilder'
import { KeyingSide } from '../components/keying/KeyingSide'
import { SubmitBar } from '../components/keying/SubmitBar'
import { issueStock, consumeStock } from '../services/stock'
import { isManager } from '../lib/transferStatus'
import { compressImage } from '../lib/image'
import { dateInputToMs, msToDateInput, todayMs } from '../lib/format'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import { useDraft } from '../lib/useDraft'
import { DraftNotice } from '../components/DraftNotice'

type Mode = 'transfer' | 'consume' | 'pos'

/**
 * เบิก/โอนสาขา in the 22 Sep frame (owner's mock-up 03, spec §2.4). Filing is immediate —
 * the mock-up's "รอดำเนินการ" state and two-step confirm are out (owner, 22 Sep: no
 * approval step for transfers) — and documents keep their IS-/CS- numbers.
 */
export function IssuePage() {
  const t = useT()
  const { user } = useAuth()
  const manager = isManager(user?.role)
  // /issue?mode=pos opens the POS-sales import directly (the recipes screen links here).
  const [params] = useSearchParams()
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'pos' ? 'pos' : manager ? 'transfer' : 'consume')

  return (
    <FramePage>
      <PageHero
        icon="send"
        tone="out"
        title={t('เบิก/โอนสาขา')}
        subtitle={t('โอนสินค้าระหว่างคลังและสาขา หรือเบิกใช้เพื่อตัดสต๊อกหน้าร้าน')}
      />
      {mode === 'transfer' ? (
        <TransferForm mode={mode} setMode={setMode} isMgr={manager} />
      ) : mode === 'pos' ? (
        <PosImportForm modeCards={<ModeCards mode={mode} setMode={setMode} isMgr={manager} />} />
      ) : (
        <ConsumeForm mode={mode} setMode={setMode} isMgr={manager} />
      )}
    </FramePage>
  )
}

/** The two big mode cards that replace the old segmented switch. */
function ModeCards({
  mode,
  setMode,
  isMgr,
}: {
  mode: Mode
  setMode: (m: Mode) => void
  isMgr: boolean
}) {
  const t = useT()
  const cards: { key: Mode; icon: IconName; title: string; hint: string }[] = [
    {
      key: 'transfer',
      icon: 'swap',
      title: t('โอนไปสาขา (เก็บสต๊อก)'),
      hint: isMgr
        ? t('โอนสินค้าจากคลังไปยังสาขา')
        : t('โอนด่วน (เฉพาะหัวหน้า) — พนักงานใช้ระบบขนส่ง'),
    },
    {
      key: 'consume',
      icon: 'report',
      title: t('เบิกใช้ / ตัดออก (หน้าร้าน)'),
      hint: t('เบิกสินค้าเพื่อตัดสต๊อก ใช้ในหน้าร้าน'),
    },
    {
      key: 'pos',
      icon: 'upload',
      title: t('ตัดตามยอดขาย POS'),
      hint: t('นำเข้าไฟล์ยอดขาย ตัดวัตถุดิบตามสูตร'),
    },
  ]
  return (
    <div role="radiogroup" aria-label={t('ประเภทการเบิก')} className={`${frameCard} grid grid-cols-3 gap-2 p-2`}>
      {cards.map((c) => {
        const on = c.key === mode
        return (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setMode(c.key)}
            className={`flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2.5 text-center sm:flex-row sm:gap-3 sm:px-3 sm:py-3 sm:text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${
              on ? 'border-brand bg-brand-soft text-brand' : 'border-transparent text-ink-soft hover:bg-sunken'
            }`}
          >
            <Icon name={c.icon} size={24} className="shrink-0" />
            <span className="min-w-0">
              <span className="block text-xs font-bold leading-snug sm:text-sm md:text-base">{c.title}</span>
              <span className={`hidden text-xs md:block ${on ? 'text-brand/80' : 'text-ink-faint'}`}>{c.hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

const transferTips = (t: (s: string) => string) => (
  <ul className="list-disc space-y-1 pl-4">
    <li>{t('ตรวจสอบสต๊อกคงเหลือต้นทางก่อนโอน — ระบบไม่ให้โอนเกินที่มี')}</li>
    <li>{t('โอนแล้วมีผลทันที ยอดต้นทางลด ยอดปลายทางเพิ่ม')}</li>
    <li>{t('คีย์ผิดแก้ได้จากรายการวันนี้ด้านบน หรือยกเลิกจากหน้าประวัติ')}</li>
  </ul>
)

// ------------------------------------------------------------------ Transfer
function TransferForm({
  mode,
  setMode,
  isMgr,
}: {
  mode: Mode
  setMode: (m: Mode) => void
  isMgr: boolean
}) {
  const t = useT()
  const navigate = useNavigate()
  const { products, locations, qtyAt } = useData()
  const { user } = useAuth()
  const toast = useToast()

  const active = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  const defaultFrom = active.find((l) => l.type === 'warehouse') ?? active[0]

  const [fromLocationId, setFromLocationId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [dateStr, setDateStr] = useState(msToDateInput(todayMs()))
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [focusOn, setFocusOn] = useState(0)
  const [busy, setBusy] = useState(false)

  // Half-keyed transfers survive leaving the screen (lib/useDraft.ts).
  const draft = useMemo(() => ({ fromLocationId, toLocationId, dateStr, note, lines }), [fromLocationId, toLocationId, dateStr, note, lines])
  const isEmpty = (d: typeof draft) => d.lines.length === 0 && !d.note.trim()
  const { restored, clear: clearDraft } = useDraft(
    'issue-transfer',
    draft,
    (d) => {
      if (d.fromLocationId) setFromLocationId(d.fromLocationId)
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

  useEffect(() => {
    if (!fromLocationId && defaultFrom) setFromLocationId(defaultFrom.id)
  }, [fromLocationId, defaultFrom])
  useEffect(() => {
    if (!toLocationId) {
      const branch = active.find((l) => l.type === 'branch' && l.id !== fromLocationId)
      if (branch) setToLocationId(branch.id)
    }
  }, [toLocationId, active, fromLocationId])

  const availableAt = (productId: string) => qtyAt(fromLocationId, productId)

  async function submit() {
    if (!fromLocationId || !toLocationId) return toast.error(t('เลือกต้นทางและปลายทาง'))
    if (fromLocationId === toLocationId) return toast.error(t('ต้นทางและปลายทางต้องต่างกัน'))
    if (lines.length === 0) return toast.error(t('เพิ่มรายการสินค้าก่อน'))
    if (lines.some((l) => !(l.qty > 0))) return toast.error(t('จำนวนต้องมากกว่า 0'))
    const over = lines.find((l) => l.qty > availableAt(l.productId))
    if (over) return toast.error(t('สต๊อกไม่พอสำหรับ "{name}"', { name: over.productName }))

    setBusy(true)
    try {
      const docNo = await issueStock({
        lines,
        fromLocationId,
        toLocationId,
        date: dateInputToMs(dateStr),
        actor: { id: user!.id, name: user!.name },
        note: note.trim() || undefined,
      })
      toast.success(t('เบิก/โอนเรียบร้อย (เลขที่ {docNo})', { docNo }))
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

  if (!isMgr) {
    return (
      <WithSidePanel
        side={<KeyingSide kind="transfer" day={day} title={t('สรุปการโอนวันนี้')} todayTitle={t('เบิก/โอนที่ทำวันนี้')} tips={transferTips(t)} />}
      >
        <ModeCards mode={mode} setMode={setMode} isMgr={isMgr} />
        <SectionCard icon="truck" title={t('โอนสินค้าระหว่างสาขา')}>
          <div className="space-y-4 py-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
              <Icon name="truck" size={32} />
            </div>
            <div className="mx-auto max-w-md space-y-1.5 px-4">
              <h3 className="text-base font-semibold text-ink">{t('การโอนตรงทันทีสงวนไว้สำหรับหัวหน้า/ผู้ดูแลระบบ')}</h3>
              <p className="text-sm text-ink-soft">
                {t('สำหรับเจ้าหน้าที่ กรุณาสร้างคำขอโอนสินค้าผ่านระบบขนส่ง เพื่อให้หัวหน้าอนุมัติและสาขาปลายทางตรวจรับ')}
              </p>
            </div>
            <div className="pt-2">
              <Button onClick={() => navigate('/transfers/new')} className="min-w-48">
                <Icon name="plus" size={18} />
                {t('สร้างคำขอโอนสินค้า (Logistics)')}
              </Button>
            </div>
          </div>
        </SectionCard>
      </WithSidePanel>
    )
  }

  return (
    <WithSidePanel
      side={<KeyingSide kind="transfer" day={day} title={t('สรุปการโอนวันนี้')} todayTitle={t('เบิก/โอนที่ทำวันนี้')} tips={transferTips(t)} />}
    >
      <ModeCards mode={mode} setMode={setMode} isMgr={isMgr} />
      {restored && <DraftNotice onDiscard={discardDraft} />}

      <SectionCard icon="note" title={t('ข้อมูลการโอนสินค้า')}>
        <div className="space-y-3 md:space-y-4">
          {/* From → to, with the arrow saying which way the goods go. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 md:gap-3">
            <Field label={t('จากคลัง (ต้นทาง)')} required>
              <SiteSelect value={fromLocationId} onChange={setFromLocationId} locations={active} />
            </Field>
            <span className="mb-1.5 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-sunken text-ink-soft md:h-9 md:w-9" aria-hidden>
              <Icon name="arrowRight" size={16} />
            </span>
            <Field label={t('ไปยังสาขา (ปลายทาง)')} required>
              <SiteSelect
                value={toLocationId}
                onChange={setToLocationId}
                locations={active.filter((l) => l.id !== fromLocationId)}
                emptyLabel={t('— เลือก —')}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
            <Field label={t('วันที่โอน')} required>
              <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
            </Field>
            <Field label={t('ผู้โอน (บันทึกอัตโนมัติ)')}>
              <Input value={user?.name ?? ''} disabled />
            </Field>
            <Field label={t('หมายเหตุ')} className="col-span-2 md:col-span-1">
              <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ระบุหมายเหตุ (ถ้ามี)')} />
            </Field>
          </div>
        </div>
      </SectionCard>

      <SectionCard icon="package" title={t('รายการสินค้า')} count={lines.length ? t('({n} รายการ)', { n: lines.length }) : undefined}>
        <LineBuilder products={products} lines={lines} onChange={setLines} availableAt={availableAt} direction="out" focusOn={focusOn} lineNotes />
      </SectionCard>

      <SubmitBar hasDraft={!isEmpty(draft)}>
        <Button onClick={submit} disabled={busy || lines.length === 0} className="w-full sm:w-auto sm:min-w-64">
          <Icon name="check" size={18} />
          {busy ? t('กำลังบันทึก...') : t('ยืนยันการโอนสินค้า ({n} รายการ)', { n: lines.length })}
        </Button>
      </SubmitBar>
    </WithSidePanel>
  )
}

// ------------------------------------------------------------------ Consume
function ConsumeForm({
  mode,
  setMode,
  isMgr,
}: {
  mode: Mode
  setMode: (m: Mode) => void
  isMgr: boolean
}) {
  const t = useT()
  const { products, locations, qtyAt } = useData()
  const { user } = useAuth()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const active = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  const defaultFrom = active.find((l) => l.type === 'warehouse') ?? active[0]

  const [fromLocationId, setFromLocationId] = useState('')
  const [dateStr, setDateStr] = useState(msToDateInput(todayMs()))
  const [note, setNote] = useState('สุขุมวิท') // prefilled note saved as data, user-editable — i18n-key
  const [lines, setLines] = useState<Line[]>([])
  const [focusOn, setFocusOn] = useState(0)
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Half-keyed issues survive leaving the screen (lib/useDraft.ts). The photo does not:
  // it is retaken, and a data URL is too big to keep.
  const draft = useMemo(() => ({ fromLocationId, dateStr, note, lines }), [fromLocationId, dateStr, note, lines])
  const isEmpty = (d: typeof draft) => d.lines.length === 0
  const { restored, clear: clearDraft } = useDraft(
    'issue-consume',
    draft,
    (d) => {
      if (d.fromLocationId) setFromLocationId(d.fromLocationId)
      if (d.dateStr) setDateStr(d.dateStr)
      if (typeof d.note === 'string') setNote(d.note)
      setLines(Array.isArray(d.lines) ? d.lines : [])
    },
    isEmpty,
  )
  function discardDraft() {
    setLines([])
    clearDraft()
  }

  useEffect(() => {
    if (!fromLocationId && defaultFrom) setFromLocationId(defaultFrom.id)
  }, [fromLocationId, defaultFrom])

  const availableAt = (productId: string) => qtyAt(fromLocationId, productId)

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setPhoto(await compressImage(file))
    } catch {
      toast.error(t('อ่านรูปไม่สำเร็จ'))
    }
  }

  async function submit() {
    if (!fromLocationId) return toast.error(t('เลือกคลังต้นทาง'))
    if (lines.length === 0) return toast.error(t('เพิ่มรายการสินค้าก่อน'))
    if (lines.some((l) => !(l.qty > 0))) return toast.error(t('จำนวนต้องมากกว่า 0'))
    const over = lines.find((l) => l.qty > availableAt(l.productId))
    if (over) return toast.error(t('สต๊อกไม่พอสำหรับ "{name}"', { name: over.productName }))

    setBusy(true)
    try {
      const docNo = await consumeStock({
        lines,
        fromLocationId,
        date: dateInputToMs(dateStr),
        actor: { id: user!.id, name: user!.name },
        note: note.trim() || undefined,
        photoDataUrl: photo ?? undefined,
      })
      toast.success(t('บันทึกเบิกใช้เรียบร้อย (เลขที่ {docNo})', { docNo }))
      setLines([])
      setFocusOn((n) => n + 1)
      setPhoto(null)
      clearDraft()
    } catch (e) {
      toast.error(t('บันทึกไม่สำเร็จ:') + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const day = dateInputToMs(dateStr)
  return (
    <WithSidePanel
      side={
        <KeyingSide
          kind="consume"
          day={day}
          title={t('สรุปการเบิกวันนี้')}
          todayTitle={t('เบิกใช้ที่ทำวันนี้')}
          tips={
            <ul className="list-disc space-y-1 pl-4">
              <li>{t('เบิกใช้ = ตัดสต๊อกออก ไม่เพิ่มเข้าสาขาอื่น')}</li>
              <li>{t('แนบรูปหลักฐานได้ทุกครั้ง ช่วยตรวจย้อนหลัง')}</li>
            </ul>
          }
        />
      }
    >
      <ModeCards mode={mode} setMode={setMode} isMgr={isMgr} />
      {restored && <DraftNotice onDiscard={discardDraft} />}

      <SectionCard icon="note" title={t('ข้อมูลการเบิกใช้')}>
        <div className="space-y-3 md:space-y-4">
          <div className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
            {t('เบิกของออกจากคลังไปใช้/ขายหน้าร้าน (เช่น สาขาสุขุมวิทที่อยู่ที่เดียวกับคลัง) — ตัดสต๊อกออก ไม่เพิ่มเข้าสาขาอื่น')}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
            <Field label={t('เบิกจากคลัง')} required>
              <SiteSelect value={fromLocationId} onChange={setFromLocationId} locations={active} />
            </Field>
            <Field label={t('วันที่เบิก')} required>
              <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
            </Field>
            <Field label={t('ผู้เบิก (บันทึกอัตโนมัติ)')} className="hidden md:block">
              <Input value={user?.name ?? ''} disabled />
            </Field>
          </div>
        </div>
      </SectionCard>

      <SectionCard icon="package" title={t('รายการสินค้าที่เบิก')} count={lines.length ? t('({n} รายการ)', { n: lines.length }) : undefined}>
        <LineBuilder products={products} lines={lines} onChange={setLines} availableAt={availableAt} direction="out" focusOn={focusOn} lineNotes />
      </SectionCard>

      <SectionCard icon="camera" title={t('ปลายทางและหลักฐาน')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('เบิกไปใช้ที่ / หมายเหตุ')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('เช่น สุขุมวิท')} />
          </Field>
          <Field label={t('รูปหลักฐาน (แนบได้ทุกครั้ง)')}>
            <div className="flex items-center gap-3">
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickPhoto} />
              {photo ? (
                <img src={photo} alt={t('หลักฐาน')} className="h-16 w-16 rounded-lg border border-line object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-line-strong text-ink-faint">
                  <Icon name="camera" size={18} />
                </div>
              )}
              <div className="space-y-1">
                <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                  <Icon name="camera" size={16} />
                  {t('ถ่าย / เลือกรูป')}
                </Button>
                {photo && (
                  <button onClick={() => setPhoto(null)} className="block text-xs text-danger hover:underline">
                    {t('ลบรูป')}
                  </button>
                )}
              </div>
            </div>
          </Field>
        </div>
      </SectionCard>

      <SubmitBar hasDraft={!isEmpty(draft)}>
        <Button onClick={submit} disabled={busy || lines.length === 0} variant="danger" className="w-full sm:w-auto sm:min-w-64">
          <Icon name="check" size={18} />
          {busy ? t('กำลังบันทึก...') : t('บันทึกเบิกใช้ ({n} รายการ)', { n: lines.length })}
        </Button>
      </SubmitBar>
    </WithSidePanel>
  )
}
