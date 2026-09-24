import { backend } from '../backend'
import type { BrandId } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import {
  canMoveAnnouncement,
  canWriteAnnouncements,
  isAnnouncementEditable,
  isCancellable,
  isSendable,
} from '../lib/announcementStatus'
import { announcementText, fitsLine, normalizeBody } from '../lib/announcementText'
import { genId } from '../lib/id'
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_SUBJECT_MAX,
  COL,
  type Announcement,
  type AnnouncementFiles,
  type AnnouncementFormat,
  type AnnouncementHistoryEntry,
  type AnnouncementSend,
  type AnnouncementTarget,
  type CompanyProfile,
  type Role,
} from '../types'
import { PROFILE_ID, companyName, withDefaults } from './companyProfile'
import { buddhistYear, padSeq, takeSeq } from './sequence'

/**
 * Company announcements: written by a หัวหน้า or admin, numbered when published, sent to
 * suppliers' LINE groups, and kept — what was said, to whom, when and by whom.
 *
 * ## Which company
 *
 * An announcement belongs to the company it is from, and lives in that company's own
 * collection (`announcements` / `lelapin__announcements`), whichever brand the writer
 * happens to be signed into. So every function here takes the company explicitly and pins
 * the backend to it, rather than following the active brand.
 *
 * ## The number
 *
 * `<prefix>-<code>-<Buddhist year>-<0001>` — PZM-ANN-2569-0001 — counted per company, per
 * document type, per year, in `counters/announcement__<year>` of that company. Issued by
 * publish() inside the same transaction that freezes the words, never for a draft.
 *
 * ## Reads
 *
 * On demand (`getRange` on createdAt, `getOne` by id). Nothing is subscribed.
 */

export interface Actor {
  id: string
  name: string
  role: Role
}

const MAX_HISTORY = 300
const MAX_SENDS = 200
/** Bumped when AnnouncementSheet's layout changes, so a snapshot says which one it used. */
export const LAYOUT_VERSION = 1

const db = (company: BrandId) => backend.forBrand(company)

function entry(actor: Actor, action: string, detail?: string): AnnouncementHistoryEntry {
  return { at: Date.now(), by: actor.id, byName: actor.name, action, ...(detail ? { detail } : {}) }
}

function requireWriter(actor: Actor): void {
  if (!canWriteAnnouncements(actor.role)) throw new AppError('ต้องเป็นหัวหน้าหรือผู้ดูแลระบบ')
}

export function counterId(announcementDate: number): string {
  return `announcement__${buddhistYear(announcementDate)}`
}

export function makeAnnouncementNo(profile: Pick<CompanyProfile, 'docPrefix' | 'announcementCode'>, year: number, seq: number): string {
  return `${profile.docPrefix}-${profile.announcementCode}-${year}-${padSeq(seq, 4)}`
}

// ---------------------------------------------------------------- reading ----

export async function getAnnouncement(company: BrandId, id: string): Promise<Announcement | null> {
  return db(company).getOne<Announcement>(COL.announcements, id)
}

export async function listAnnouncements(company: BrandId, from: number, to: number): Promise<Announcement[]> {
  const rows = await db(company).getRange<Announcement>(COL.announcements, 'createdAt', from, to)
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

// ---------------------------------------------------------------- content ----

export interface AnnouncementContent {
  announcementDate: number
  subject: string
  body: string
  format: AnnouncementFormat
  target: AnnouncementTarget
}

/** The words, checked: what the form and the service both refuse. */
export function cleanContent(c: AnnouncementContent): AnnouncementContent {
  const subject = c.subject.trim()
  const body = normalizeBody(c.body)
  if (!subject) throw new AppError('กรุณากรอกเรื่อง')
  if (subject.length > ANNOUNCEMENT_SUBJECT_MAX) throw new AppError('เรื่องยาวเกิน {n} ตัวอักษร', { n: ANNOUNCEMENT_SUBJECT_MAX })
  if (!body) throw new AppError('กรุณากรอกเนื้อหา')
  if (body.length > ANNOUNCEMENT_BODY_MAX) throw new AppError('เนื้อหายาวเกิน {n} ตัวอักษร', { n: ANNOUNCEMENT_BODY_MAX })
  if (!Number.isFinite(c.announcementDate) || c.announcementDate <= 0) throw new AppError('กรุณาเลือกวันที่ประกาศ')
  if (c.format !== 'text' && c.format !== 'a5') throw new AppError('กรุณาเลือกรูปแบบ')
  const scope = [...new Set(c.target.companyScope)].filter((b) => b === 'pizza' || b === 'lelapin')
  if (scope.length === 0) throw new AppError('กรุณาเลือกกลุ่มผู้ขาย')
  if (c.target.mode !== 'personal') throw new AppError('ยังไม่เปิดใช้การส่งอัตโนมัติผ่าน LINE OA')
  return { announcementDate: c.announcementDate, subject, body, format: c.format, target: { mode: 'personal', companyScope: scope } }
}

/** Read-modify-write one announcement inside a transaction. */
async function mutate(
  company: BrandId,
  id: string,
  fn: (a: Announcement) => Announcement,
): Promise<Announcement> {
  return db(company).transaction(async (tx) => {
    const cur = await tx.get<Announcement>(COL.announcements, id)
    if (!cur) throw new AppError('ไม่พบประกาศ')
    const next = fn({ ...cur, id })
    const saved: Announcement = { ...next, history: next.history.slice(-MAX_HISTORY), updatedAt: Date.now() }
    const { id: docId, ...data } = saved
    tx.set(COL.announcements, docId, data)
    return saved
  })
}

export async function createAnnouncement(company: BrandId, content: AnnouncementContent, actor: Actor): Promise<Announcement> {
  requireWriter(actor)
  const c = cleanContent(content)
  const now = Date.now()
  const a: Announcement = {
    id: genId(),
    status: 'draft',
    company,
    ...c,
    publisherId: actor.id,
    publisherName: actor.name,
    sends: [],
    history: [entry(actor, 'created')],
    createdBy: actor.id,
    createdByName: actor.name,
    createdAt: now,
    updatedAt: now,
  }
  const { id, ...data } = a
  await db(company).set(COL.announcements, id, data)
  return a
}

/** Change the words. A `ready` announcement goes back to draft: what was previewed is not this. */
export async function updateAnnouncement(company: BrandId, id: string, content: AnnouncementContent, actor: Actor): Promise<Announcement> {
  requireWriter(actor)
  const c = cleanContent(content)
  return mutate(company, id, (a) => {
    if (!isAnnouncementEditable(a.status)) throw new AppError('ประกาศที่เผยแพร่แล้วแก้ไขไม่ได้')
    return { ...a, ...c, status: 'draft', history: [...a.history, entry(actor, 'edited')] }
  })
}

/**
 * Checked and previewed: ready to be numbered. An A5 whose words do not fit the page is
 * refused here rather than printed broken — the screen measured it (`a5Fits`).
 */
export async function markReady(company: BrandId, id: string, check: { a5Fits: boolean }, actor: Actor): Promise<Announcement> {
  requireWriter(actor)
  return mutate(company, id, (a) => {
    if (!canMoveAnnouncement(a.status, 'ready')) throw new AppError('ประกาศนี้อยู่ในสถานะที่ทำรายการนี้ไม่ได้')
    if (a.format === 'a5' && !check.a5Fits) throw new AppError('เนื้อหายาวเกินหน้า A5 — ย่อให้สั้นลงหรือเปลี่ยนเป็นแบบข้อความ')
    const text = announcementText({ ...a, companyName: '', docNo: 'X' })
    if (!fitsLine(text)) throw new AppError('ข้อความยาวเกินที่ LINE ส่งได้ในครั้งเดียว')
    return { ...a, status: 'ready', history: [...a.history, entry(actor, 'ready')] }
  })
}

/**
 * Issue the number and freeze the words, in one transaction: the counter, the company's
 * prefix and the document are read together, so two people publishing at the same moment
 * get two numbers, and a number is never issued to something that did not get published.
 *
 * The picture and the PDF are made afterwards, from the snapshot (attachFiles) — a failed
 * upload leaves a published announcement that can make its files again, with the same
 * number, rather than a number with nothing behind it.
 */
export async function publishAnnouncement(company: BrandId, id: string, actor: Actor): Promise<Announcement> {
  requireWriter(actor)
  return db(company).transaction(async (tx) => {
    const cur = await tx.get<Announcement>(COL.announcements, id)
    if (!cur) throw new AppError('ไม่พบประกาศ')
    if (cur.docNo) throw new AppError('ประกาศนี้เผยแพร่ไปแล้ว ({docNo})', { docNo: cur.docNo })
    if (!canMoveAnnouncement(cur.status, 'published')) throw new AppError('ต้องตรวจตัวอย่างและกดพร้อมเผยแพร่ก่อน')
    const profile = withDefaults(company, await tx.get<CompanyProfile>(COL.companyProfile, PROFILE_ID))
    const taken = await takeSeq(tx, counterId(cur.announcementDate))
    // ---- writes ----
    taken.commit()
    const now = Date.now()
    const docNo = makeAnnouncementNo(profile, buddhistYear(cur.announcementDate), taken.seq)
    const name = companyName(company, profile)
    const next: Announcement = {
      ...cur,
      id,
      docNo,
      status: 'published',
      publishedAt: now,
      publishedBy: actor.id,
      snapshot: {
        subject: cur.subject,
        body: cur.body,
        text: announcementText({ ...cur, docNo, companyName: name }),
        companyName: name,
        logoVersion: profile.logoVersion ?? 0,
        layoutVersion: LAYOUT_VERSION,
      },
      history: [...cur.history, entry(actor, 'published', docNo)].slice(-MAX_HISTORY),
      updatedAt: now,
    }
    const { id: docId, ...data } = next
    tx.set(COL.announcements, docId, data)
    return next
  })
}

/** Where the A5's PDF and picture were put. Made again only while none exist. */
export async function attachFiles(
  company: BrandId,
  id: string,
  files: Omit<AnnouncementFiles, 'createdAt'>,
  actor: Actor,
): Promise<Announcement> {
  requireWriter(actor)
  return mutate(company, id, (a) => {
    if (!a.docNo || !isSendable(a)) throw new AppError('ต้องเผยแพร่ก่อน')
    if (a.format !== 'a5') throw new AppError('ประกาศแบบข้อความไม่มีไฟล์ PDF')
    if (a.files) throw new AppError('ประกาศนี้มีไฟล์แล้ว')
    return {
      ...a,
      files: { ...files, createdAt: Date.now() },
      history: [...a.history, entry(actor, 'filesCreated')],
    }
  })
}

/**
 * What a send came back with, recorded as the provider reported it and nothing more.
 *
 * `sent` moves the announcement to sent. A share sheet reports only that it opened; the
 * person then says whether it went (`confirmed`). A failure is kept too — the send log is
 * the answer to "what did we send to whom, and when", and a failure is part of it.
 */
export async function recordSend(
  company: BrandId,
  id: string,
  send: Omit<AnnouncementSend, 'at' | 'by' | 'byName'>,
  actor: Actor,
): Promise<Announcement> {
  requireWriter(actor)
  return mutate(company, id, (a) => {
    if (!isSendable(a)) throw new AppError('ต้องเผยแพร่ก่อน')
    // LINE's picker sends a picture by its address, so an A5 needs its hosted files first;
    // a phone's share sheet hands over the picture file itself and needs none.
    if (a.format === 'a5' && !a.files && send.via === 'liff') throw new AppError('ยังไม่มีไฟล์ PDF สำหรับส่ง')
    if (a.sends.length >= MAX_SENDS) throw new AppError('บันทึกการส่งเต็มแล้ว')
    const kept = Object.fromEntries(Object.entries(send).filter(([, v]) => v !== undefined)) as typeof send
    const row: AnnouncementSend = { at: Date.now(), by: actor.id, byName: actor.name, ...kept }
    const status = send.outcome === 'sent' && a.status !== 'sent' ? 'sent' : a.status
    return {
      ...a,
      status,
      sends: [...a.sends, row],
      history: [...a.history, entry(actor, `send:${send.outcome}`, send.groupName)],
    }
  })
}

export async function cancelAnnouncement(company: BrandId, id: string, reason: string, actor: Actor): Promise<Announcement> {
  requireWriter(actor)
  const why = reason.trim()
  if (!why) throw new AppError('กรุณาระบุเหตุผล')
  return mutate(company, id, (a) => {
    if (!isCancellable(a)) throw new AppError('ประกาศที่ส่งออกไปแล้วยกเลิกไม่ได้')
    const now = Date.now()
    return {
      ...a,
      status: 'cancelled',
      cancelReason: why,
      cancelledBy: actor.id,
      cancelledAt: now,
      history: [...a.history, entry(actor, 'cancelled', why)],
    }
  })
}
