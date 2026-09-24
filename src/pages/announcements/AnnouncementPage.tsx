import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useBrand } from '../../brand/BrandContext'
import { BRANDS, brandDef, type BrandId } from '../../brand/brand'
import { AnnouncementSheet } from '../../components/AnnouncementSheet'
import { useConfirm } from '../../components/Confirm'
import { Icon } from '../../components/Icon'
import { useToast } from '../../components/Toast'
import { AlertBanner, Badge, Button, EmptyState, Field, Input, SegTab, Spinner, Textarea } from '../../components/ui'
import { FramePage, PageHero, SectionCard, frameCard } from '../../components/frame'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { A5_PX, A5_SOFT_CHARS, a5PdfFromJpeg, bodyFits } from '../../lib/a5'
import {
  ANNOUNCEMENT_STATUS_KEYS,
  announcementBadge,
  canWriteAnnouncements,
  isAnnouncementEditable,
  isCancellable,
  isSendable,
} from '../../lib/announcementStatus'
import { a5Caption, announcementText } from '../../lib/announcementText'
import { dateInputToMs, formatThaiDateTime, msToDateInput, todayMs } from '../../lib/format'
import { renderElementToJpeg } from '../../lib/poImage'
import * as A from '../../services/announcements'
import { companyName, useCompanyProfile } from '../../services/companyProfile'
import { imageHostAvailable, uploadAnnouncementFiles } from '../../services/poImages'
import { pickShareProvider, type ShareOutcome } from '../../share'
import { ANNOUNCE_PARAM } from '../../share/liffResume'
import { ReasonModal } from '../requests/ReasonModal'
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_SUBJECT_MAX,
  type Announcement,
  type AnnouncementFormat,
} from '../../types'

/**
 * `/announcements/new` and `/announcements/:company/:id`.
 *
 * One screen for the whole life of an announcement: write it (with the preview beside the
 * form), mark it checked, publish it (the number is issued then), make its A5 files, send
 * it through LINE, and read back what was sent, to whom and when. Everything after the
 * number is read-only — the snapshot is what went out.
 */

const PREVIEW_SCALE = 0.58

interface Form {
  company: BrandId
  date: string
  subject: string
  body: string
  format: AnnouncementFormat
  scope: BrandId[]
}

function formOf(a: Announcement): Form {
  return {
    company: a.company,
    date: msToDateInput(a.announcementDate),
    subject: a.subject,
    body: a.body,
    format: a.format,
    scope: a.target.companyScope,
  }
}

export function AnnouncementPage() {
  // Both routes render this component at the same place in the tree, so React would keep
  // one announcement's state when the URL moves to another (or to /new). Keyed on the URL,
  // each document gets a fresh screen.
  const { company, id } = useParams()
  return <AnnouncementLoader key={`${company ?? ''}/${id ?? 'new'}`} />
}

function AnnouncementLoader() {
  const t = useT()
  const { company: companyParam, id } = useParams()
  const [params, setParams] = useSearchParams()
  const { brand } = useBrand()
  const isNew = !id
  const initialCompany = ((isNew ? params.get('company') : companyParam) ?? brand ?? 'pizza') as BrandId
  const [doc, setDoc] = useState<Announcement | null | undefined>(isNew ? null : undefined)

  useEffect(() => {
    if (isNew) return
    let live = true
    A.getAnnouncement(initialCompany, id!).then((a) => live && setDoc(a))
    return () => {
      live = false
    }
  }, [isNew, id, initialCompany])

  // Back from LINE Login with ?announce=<id>: the picker cannot open itself without a tap,
  // so the page says where the person got to and leaves the button to them.
  const resumed = params.get(ANNOUNCE_PARAM) === id
  useEffect(() => {
    if (!params.get(ANNOUNCE_PARAM)) return
    const next = new URLSearchParams(params)
    next.delete(ANNOUNCE_PARAM)
    next.delete('brand')
    setParams(next, { replace: true })
  }, [params, setParams])

  if (doc === undefined) return <Spinner label={t('กำลังโหลด...')} />
  if (!isNew && !doc) return <EmptyState icon="megaphone" title={t('ไม่พบประกาศ')} />
  return <AnnouncementScreen key={doc?.id ?? 'new'} initial={doc} company={doc?.company ?? initialCompany} resumed={resumed} />
}

function AnnouncementScreen({ initial, company: startCompany, resumed }: { initial: Announcement | null; company: BrandId; resumed: boolean }) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [doc, setDoc] = useState<Announcement | null>(initial)
  const [form, setForm] = useState<Form>(() =>
    initial ? formOf(initial) : { company: startCompany, date: msToDateInput(todayMs()), subject: '', body: '', format: 'text', scope: [startCompany] },
  )
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'' | 'save' | 'ready' | 'publish' | 'files' | 'send'>('')
  const [askSent, setAskSent] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [fits, setFits] = useState(true)
  const sheetRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const company = doc?.company ?? form.company
  const { profile } = useCompanyProfile(company)
  const name = companyName(company, profile)
  const accent = brandDef(company).accent
  const actor = user ? { id: user.id, name: user.name, role: user.role } : null
  const canWrite = canWriteAnnouncements(user?.role)
  const editable = canWrite && (!doc || isAnnouncementEditable(doc.status))
  const frozen = doc?.snapshot

  // What the preview and the photographed sheet show: the snapshot once published.
  const shown = frozen
    ? { subject: frozen.subject, body: frozen.body, date: doc!.announcementDate, publisher: doc!.publisherName, docNo: doc!.docNo }
    : { subject: form.subject, body: form.body, date: dateInputToMs(form.date), publisher: doc?.publisherName ?? user?.name ?? '', docNo: doc?.docNo }
  const format = doc && !editable ? doc.format : form.format

  const text = useMemo(
    () =>
      frozen?.text ??
      announcementText({ docNo: shown.docNo, companyName: name, announcementDate: shown.date, subject: shown.subject, body: shown.body, publisherName: shown.publisher }),
    [frozen, shown.docNo, name, shown.date, shown.subject, shown.body, shown.publisher],
  )

  // Measure the full-size sheet after every change: does the body still fit the page?
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    setFits(bodyFits(el.scrollHeight, el.clientHeight))
  }, [shown.body, shown.subject, format, profile.logoDataUrl])

  function update(patch: Partial<Form>) {
    setForm((f) => ({ ...f, ...patch }))
    setDirty(true)
  }

  const content = (): A.AnnouncementContent => ({
    announcementDate: dateInputToMs(form.date),
    subject: form.subject,
    body: form.body,
    format: form.format,
    target: { mode: 'personal', companyScope: form.scope },
  })

  async function save(): Promise<Announcement | null> {
    if (!actor) return null
    if (!doc) {
      const created = await A.createAnnouncement(form.company, content(), actor)
      setDoc(created)
      setDirty(false)
      navigate(`/announcements/${created.company}/${created.id}`, { replace: true })
      return created
    }
    if (!dirty) return doc
    const next = await A.updateAnnouncement(doc.company, doc.id, content(), actor)
    setDoc(next)
    setDirty(false)
    return next
  }

  async function run(kind: typeof busy, fn: () => Promise<void>) {
    setBusy(kind)
    try {
      await fn()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  const onSave = () =>
    run('save', async () => {
      await save()
      toast.success(t('บันทึกร่างแล้ว'))
    })

  const onReady = () =>
    run('ready', async () => {
      const saved = await save()
      if (!saved || !actor) return
      setDoc(await A.markReady(saved.company, saved.id, { a5Fits: fits }, actor))
      toast.success(t('ตรวจแล้ว — พร้อมเผยแพร่'))
    })

  /**
   * The A5's picture and PDF, made from the sheet as published and put where LINE can
   * fetch them. Also the retry when a first upload failed: same number, same words.
   */
  async function makeFiles(a: Announcement): Promise<Announcement> {
    if (!actor || !sheetRef.current || !a.docNo) return a
    if (!imageHostAvailable()) throw new Error(t('เครื่องนี้ยังไม่ได้ตั้งค่าที่เก็บไฟล์สำหรับส่ง LINE — ดาวน์โหลด PDF แล้วส่งเองได้'))
    const image = await renderElementToJpeg(sheetRef.current, { scale: 2.5, quality: 0.9 })
    const preview = await renderElementToJpeg(sheetRef.current, { scale: 1, quality: 0.8 })
    const pdf = await a5PdfFromJpeg(image, { title: a.docNo, author: name })
    const hosted = await uploadAnnouncementFiles({ id: a.id, pdf, image, preview })
    return A.attachFiles(a.company, a.id, hosted, actor)
  }

  const onPublish = () =>
    run('publish', async () => {
      if (!doc || !actor) return
      const ok = await confirm({
        title: t('เผยแพร่ประกาศ'),
        message: t('ระบบจะออกเลขที่เอกสาร และแก้ไขเนื้อหาไม่ได้อีก — ยืนยัน?'),
        confirmText: t('เผยแพร่'),
      })
      if (!ok) return
      let next = await A.publishAnnouncement(doc.company, doc.id, actor)
      setDoc(next)
      toast.success(t('เผยแพร่แล้ว {docNo}', { docNo: next.docNo ?? '' }))
      if (next.format === 'a5') {
        // Let the sheet re-render with its number before it is photographed.
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        try {
          next = await makeFiles(next)
          setDoc(next)
        } catch (e) {
          toast.error(errText(e, t))
        }
      }
    })

  const onMakeFiles = () =>
    run('files', async () => {
      if (doc) setDoc(await makeFiles(doc))
    })

  async function downloadPdf() {
    if (!sheetRef.current || !doc?.docNo) return
    await run('files', async () => {
      const image = await renderElementToJpeg(sheetRef.current!, { scale: 2.5, quality: 0.9 })
      const pdf = await a5PdfFromJpeg(image, { title: doc.docNo!, author: name })
      const url = URL.createObjectURL(pdf)
      const link = document.createElement('a')
      link.href = url
      link.download = `${doc.docNo}.pdf`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    })
  }

  async function record(outcome: 'sent' | 'shareOpened' | 'failed', via: 'liff' | 'shareSheet' | 'confirmed', error?: string) {
    if (!doc || !actor) return
    setDoc(await A.recordSend(doc.company, doc.id, { mode: 'personal', outcome, via, ...(error ? { error: error.slice(0, 300) } : {}) }, actor))
  }

  const onSend = () =>
    run('send', async () => {
      if (!doc || !doc.docNo || !sheetRef.current) return
      const provider = await pickShareProvider()
      let outcome: ShareOutcome
      try {
        if (doc.format === 'a5') {
          if (provider.needsHosting && !doc.files) throw new Error(t('ยังไม่มีไฟล์ PDF สำหรับส่ง — กด "สร้างไฟล์ PDF" ก่อน'))
          const image = await renderElementToJpeg(sheetRef.current, { scale: 2, quality: 0.9 })
          const file = new File([image], `${doc.docNo}.jpg`, { type: 'image/jpeg' })
          const pdfUrl = doc.files?.pdfUrl
          outcome = await provider.share({
            subject: { kind: 'announcement', id: doc.id },
            file,
            ...(doc.files ? { hosted: { url: doc.files.imageUrl, previewUrl: doc.files.previewUrl } } : {}),
            caption: pdfUrl
              ? a5Caption({ docNo: doc.docNo, companyName: name, subject: doc.subject, pdfUrl })
              : `${t('ประกาศ')} ${doc.docNo} — ${name}`,
          })
        } else {
          outcome = await provider.share({ subject: { kind: 'announcement', id: doc.id }, caption: text })
        }
      } catch (e) {
        await record('failed', provider.id === 'line-liff' ? 'liff' : 'shareSheet', errText(e, t)).catch(() => {})
        throw e
      }
      if (outcome === 'sent') {
        await record('sent', 'liff')
        toast.success(t('ส่งเข้า LINE แล้ว'))
      } else if (outcome === 'shareOpened') {
        await record('shareOpened', 'shareSheet')
        // The share sheet told us nothing. Ask the one person who knows.
        setAskSent(true)
      }
    })

  async function onCancel(reason: string) {
    if (!doc || !actor) return
    try {
      setDoc(await A.cancelAnnouncement(doc.company, doc.id, reason, actor))
      setCancelling(false)
      toast.success(t('ยกเลิกประกาศแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  const status = doc?.status
  const title = doc?.docNo ?? (doc ? t('ร่างประกาศ') : t('สร้างประกาศ'))
  const longForA5 = format === 'a5' && shown.body.length > A5_SOFT_CHARS

  return (
    <FramePage>
      <PageHero
        icon="megaphone"
        title={title}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {name}
            {status && <Badge color={announcementBadge(status)}>{t(ANNOUNCEMENT_STATUS_KEYS[status])}</Badge>}
          </span>
        }
        actions={
          <Button variant="outline" onClick={() => navigate(`/announcements?company=${company}`)}>
            <Icon name="chevronLeft" size={16} />
            {t('รายการประกาศ')}
          </Button>
        }
      />

      {resumed && isSendable(doc ?? { status: 'draft' }) && (
        <AlertBanner tone="info" icon="info">
          {t('เข้าสู่ระบบ LINE แล้ว — กด "ส่ง LINE" อีกครั้งเพื่อเลือกกลุ่ม')}
        </AlertBanner>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-4">
          {editable ? (
            <SectionCard icon="pencil" title={t('เนื้อหาประกาศ')}>
              <div className="space-y-4">
                {!doc && (
                  <Field label={t('บริษัท')}>
                    <div className="flex gap-1 rounded-lg bg-sunken p-1">
                      {BRANDS.map((b) => (
                        <SegTab key={b.id} label={b.name} active={form.company === b.id} onClick={() => update({ company: b.id, scope: [b.id] })} />
                      ))}
                    </div>
                  </Field>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('วันที่ประกาศ')} required>
                    <Input type="date" value={form.date} onChange={(e) => update({ date: e.target.value })} />
                  </Field>
                  <Field label={t('รูปแบบ')} required>
                    <div className="flex gap-1 rounded-lg bg-sunken p-1">
                      <SegTab label={t('ข้อความ LINE')} active={form.format === 'text'} onClick={() => update({ format: 'text' })} />
                      <SegTab label={t('เอกสาร A5')} active={form.format === 'a5'} onClick={() => update({ format: 'a5' })} />
                    </div>
                  </Field>
                </div>
                <Field label={t('เรื่อง')} required hint={`${form.subject.length}/${ANNOUNCEMENT_SUBJECT_MAX}`}>
                  <Input value={form.subject} maxLength={ANNOUNCEMENT_SUBJECT_MAX} onChange={(e) => update({ subject: e.target.value })} />
                </Field>
                <Field label={t('เนื้อหา')} required hint={`${form.body.length}/${ANNOUNCEMENT_BODY_MAX}`}>
                  <Textarea rows={10} value={form.body} maxLength={ANNOUNCEMENT_BODY_MAX} onChange={(e) => update({ body: e.target.value })} />
                </Field>
                <Field label={t('ส่งถึงกลุ่มผู้ขายของ')} required hint={t('ผู้ส่งเลือกกลุ่ม LINE เองในหน้าจอของ LINE')}>
                  <div className="flex flex-wrap gap-3">
                    {BRANDS.map((b) => (
                      <label key={b.id} className="inline-flex min-h-11 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          checked={form.scope.includes(b.id)}
                          onChange={(e) =>
                            update({ scope: e.target.checked ? [...new Set([...form.scope, b.id])] : form.scope.filter((x) => x !== b.id) })
                          }
                        />
                        {t('ผู้ขาย {name}', { name: b.name })}
                      </label>
                    ))}
                  </div>
                </Field>
                <p className="text-xs text-ink-soft">
                  {t('ผู้ประกาศ')}: <span className="font-medium text-ink">{doc?.publisherName ?? user?.name}</span> — {t('มาจากบัญชีที่เข้าสู่ระบบ')}
                </p>
              </div>
            </SectionCard>
          ) : null}

          {format === 'a5' && !fits && (
            <AlertBanner tone="warn">{t('เนื้อหายาวเกินหน้า A5 — ตัดให้สั้นลงหรือเปลี่ยนเป็นแบบข้อความ')}</AlertBanner>
          )}
          {longForA5 && fits && (
            <AlertBanner tone="info" icon="info">{t('A5 เหมาะกับประกาศสั้น — ตรวจตัวอย่างว่าอ่านง่าย')}</AlertBanner>
          )}

          <SectionCard icon="checkCircle" title={t('ขั้นตอน')}>
            <div className="flex flex-wrap gap-2">
              {editable && (
                <>
                  <Button variant="outline" onClick={onSave} disabled={!!busy}>
                    {busy === 'save' ? t('กำลังบันทึก...') : t('บันทึกร่าง')}
                  </Button>
                  {status !== 'ready' || dirty ? (
                    <Button onClick={onReady} disabled={!!busy || (format === 'a5' && !fits)}>
                      <Icon name="check" size={16} />
                      {t('ตรวจตัวอย่างแล้ว พร้อมเผยแพร่')}
                    </Button>
                  ) : (
                    <Button onClick={onPublish} disabled={!!busy}>
                      <Icon name="megaphone" size={16} />
                      {busy === 'publish' ? t('กำลังเผยแพร่...') : t('เผยแพร่ (ออกเลขที่)')}
                    </Button>
                  )}
                </>
              )}
              {doc && isSendable(doc) && canWrite && (
                <>
                  {doc.format === 'a5' && !doc.files && (
                    <Button variant="outline" onClick={onMakeFiles} disabled={!!busy}>
                      <Icon name="refresh" size={16} />
                      {busy === 'files' ? t('กำลังสร้างไฟล์...') : t('สร้างไฟล์ PDF')}
                    </Button>
                  )}
                  <Button onClick={onSend} disabled={!!busy}>
                    <Icon name="share" size={16} />
                    {busy === 'send' ? t('กำลังเปิด LINE...') : t('ส่ง LINE')}
                  </Button>
                </>
              )}
              {doc?.docNo && doc.format === 'a5' && (
                <Button variant="pdf" onClick={() => void downloadPdf()} disabled={!!busy}>
                  <Icon name="download" size={16} />
                  {t('ดาวน์โหลด PDF')}
                </Button>
              )}
              {doc?.files && (
                <a className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm text-brand underline" href={doc.files.pdfUrl} target="_blank" rel="noreferrer">
                  {t('เปิดลิงก์ PDF')}
                </a>
              )}
              {doc && canWrite && isCancellable(doc) && (
                <Button variant="ghost" onClick={() => setCancelling(true)} disabled={!!busy}>
                  {t('ยกเลิกประกาศ')}
                </Button>
              )}
            </div>
            {askSent && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-sunken p-3 text-sm">
                <span className="flex-1">{t('ส่งเข้ากลุ่ม LINE เรียบร้อยแล้วใช่ไหม?')}</span>
                <Button
                  size="sm"
                  onClick={() =>
                    run('send', async () => {
                      await record('sent', 'confirmed')
                      setAskSent(false)
                    })
                  }
                >
                  {t('ส่งแล้ว')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAskSent(false)}>
                  {t('ยังไม่ได้ส่ง')}
                </Button>
              </div>
            )}
            {doc?.status === 'cancelled' && doc.cancelReason && (
              <p className="mt-3 text-sm text-danger">
                {t('ยกเลิกแล้ว')}: {doc.cancelReason}
              </p>
            )}
          </SectionCard>

          {doc && (doc.sends.length > 0 || doc.history.length > 0) && (
            <SectionCard icon="history" title={t('ประวัติ')}>
              {doc.sends.length > 0 && (
                <div className="mb-4">
                  <div className="mb-2 text-sm font-semibold text-ink">{t('บันทึกการส่ง')}</div>
                  <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                    {doc.sends.map((s, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <Badge color={s.outcome === 'sent' ? 'green' : s.outcome === 'failed' ? 'red' : 'amber'}>{t(SEND_KEYS[s.outcome])}</Badge>
                        <span className="text-ink-soft">{t(VIA_KEYS[s.via])}</span>
                        {s.groupName && <span>{s.groupName}</span>}
                        <span className="ml-auto text-xs text-ink-faint">
                          {s.byName} · {formatThaiDateTime(s.at)}
                        </span>
                        {s.error && <span className="w-full text-xs text-danger">{s.error}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <ul className="space-y-1 text-sm">
                {[...doc.history].reverse().map((h, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2">
                    <span className="text-ink">{historyLabel(h.action, t)}</span>
                    {h.detail && <span className="text-ink-soft">{h.detail}</span>}
                    <span className="ml-auto text-xs text-ink-faint">
                      {h.byName} · {formatThaiDateTime(h.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </div>

        <aside className="min-w-0 space-y-2">
          <div className="text-sm font-semibold text-ink">{format === 'a5' ? t('ตัวอย่าง A5') : t('ตัวอย่างข้อความใน LINE')}</div>
          {format === 'a5' ? (
            <div className={`${frameCard} overflow-hidden p-2`}>
              <div style={{ width: A5_PX.width * PREVIEW_SCALE, height: A5_PX.height * PREVIEW_SCALE }}>
                <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
                  <AnnouncementSheet
                    companyName={name}
                    logoDataUrl={profile.logoDataUrl}
                    accent={accent}
                    docNo={shown.docNo}
                    announcementDate={shown.date}
                    subject={shown.subject}
                    body={shown.body}
                    publisherName={shown.publisher}
                  />
                </div>
              </div>
            </div>
          ) : (
            <pre className={`${frameCard} max-w-[26rem] whitespace-pre-wrap break-words p-4 font-sans text-sm leading-relaxed text-ink`}>{text}</pre>
          )}
        </aside>
      </div>

      {/* The same sheet at full size, off screen: what is measured and photographed. */}
      <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
        <AnnouncementSheet
          ref={sheetRef}
          bodyRef={bodyRef}
          companyName={name}
          logoDataUrl={profile.logoDataUrl}
          accent={accent}
          docNo={shown.docNo}
          announcementDate={shown.date}
          subject={shown.subject}
          body={shown.body}
          publisherName={shown.publisher}
        />
      </div>

      {cancelling && (
        <ReasonModal
          title={t('ยกเลิกประกาศ')}
          message={t('ประกาศที่ยกเลิกยังเก็บไว้พร้อมเลขที่และเหตุผล')}
          confirmText={t('ยกเลิกประกาศ')}
          danger
          onClose={() => setCancelling(false)}
          onConfirm={onCancel}
        />
      )}
    </FramePage>
  )
}

const SEND_KEYS = {
  sent: 'ส่งแล้ว', // i18n-key
  shareOpened: 'เปิดหน้าแชร์', // i18n-key
  failed: 'ส่งไม่สำเร็จ', // i18n-key
} as const

const VIA_KEYS = {
  liff: 'LINE ยืนยันว่าส่ง', // i18n-key
  shareSheet: 'ผ่านหน้าแชร์ของเครื่อง', // i18n-key
  confirmed: 'ผู้ส่งยืนยันเอง', // i18n-key
  oa: 'LINE Official Account', // i18n-key
} as const

const HISTORY_KEYS: Record<string, string> = {
  created: 'สร้างร่าง', // i18n-key
  edited: 'แก้ไขเนื้อหา', // i18n-key
  ready: 'ตรวจตัวอย่างแล้ว', // i18n-key
  published: 'เผยแพร่ ออกเลขที่', // i18n-key
  filesCreated: 'สร้างไฟล์ PDF และรูป', // i18n-key
  cancelled: 'ยกเลิก', // i18n-key
  'send:sent': 'ส่งแล้ว', // i18n-key
  'send:shareOpened': 'เปิดหน้าแชร์', // i18n-key
  'send:failed': 'ส่งไม่สำเร็จ', // i18n-key
}

function historyLabel(action: string, t: (k: string) => string): string {
  const key = HISTORY_KEYS[action]
  return key ? t(key) : action
}
