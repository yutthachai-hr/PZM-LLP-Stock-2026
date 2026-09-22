import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { formatThaiDateTime } from '../../lib/format'
import { bkkTimeOf } from '../../lib/inventoryRules/time'
import { isManager } from '../../lib/purchaseRequestStatus'
import {
  DEFAULT_DAYS,
  deleteMessage,
  listMessages,
  markMessagesRead,
  sendMessage,
  setPinned,
  sortForBoard,
  unreadCount,
} from '../../services/messages'
import { MESSAGE_MAX, type AppMessage } from '../../types'
import { Icon } from '../Icon'
import { useToast } from '../Toast'
import { Button, Modal, Textarea } from '../ui'

/**
 * The message board in the top bar (owner's mock-ups, spec §4): notes for whoever is on
 * shift — "ของ FOODGALLERY มาบ่ายนี้" — not a chat.
 *
 * Reads: one range query when the app opens (for the badge) and again while the panel is
 * open, every five minutes. Nothing is subscribed. Opening the panel writes one field on
 * your own profile, which is what the unread count is measured from.
 */
const REFRESH_MS = 5 * 60 * 1000

export function MessagesButton() {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<AppMessage[]>([])
  const [days, setDays] = useState(DEFAULT_DAYS)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  // What the badge counts from: the profile's value when the app loaded, then the moment
  // the panel was last opened on this device.
  const [readAt, setReadAt] = useState<number | undefined>(user?.messagesReadAt)

  const load = useCallback(
    async (n = days, force = false) => {
      try {
        setRows(await listMessages(n, { force }))
      } catch {
        /* the board is not worth a toast on every refresh; the panel shows what it has */
      }
    },
    [days],
  )

  // Once when the app opens — this is what the badge is counted from.
  useEffect(() => {
    if (user) void load()
  }, [user, load])

  // And while the panel is open, in case someone else has written since.
  const timer = useRef(0)
  useEffect(() => {
    if (!open) return
    timer.current = window.setInterval(() => void load(days, true), REFRESH_MS)
    return () => window.clearInterval(timer.current)
  }, [open, days, load])

  if (!user) return null
  const manager = isManager(user.role)
  const unread = unreadCount(rows, readAt, user.id)

  async function openPanel() {
    setOpen(true)
    await load(days, true)
    const at = Date.now()
    setReadAt(at)
    try {
      await markMessagesRead(user!.id, at)
    } catch {
      /* the badge is a convenience; a failed write must not block the board */
    }
  }

  async function send() {
    setBusy(true)
    try {
      const saved = await sendMessage({ body, actor: { id: user!.id, name: user!.name } })
      setRows((cur) => sortForBoard([saved, ...cur.filter((m) => m.id !== saved.id)]))
      setBody('')
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  async function remove(m: AppMessage) {
    try {
      await deleteMessage(m, { id: user!.id, role: user!.role })
      setRows((cur) => cur.filter((x) => x.id !== m.id))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  async function pin(m: AppMessage, value: boolean) {
    try {
      const next = await setPinned(m, value)
      setRows((cur) => sortForBoard(cur.map((x) => (x.id === m.id ? next : x))))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  return (
    <>
      <button
        onClick={() => void openPanel()}
        className="relative inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-ink-soft outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40"
        aria-label={unread > 0 ? t('ข้อความภายใน ({n} ใหม่)', { n: unread }) : t('ข้อความภายใน')}
      >
        <Icon name="message" size={19} />
        {unread > 0 && (
          <span className="num absolute right-1 top-1 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] font-bold leading-4 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      <Modal
        open={open}
        sheet
        onClose={() => setOpen(false)}
        title={t('ข้อความภายใน')}
        footer={
          <div className="space-y-2">
            <Textarea
              rows={2}
              value={body}
              maxLength={MESSAGE_MAX}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('เช่น ของ FOODGALLERY มาบ่ายนี้')}
              aria-label={t('ข้อความใหม่')}
            />
            <div className="flex items-center gap-2">
              <span className="num text-xs text-ink-faint">
                {body.length}/{MESSAGE_MAX}
              </span>
              <Button onClick={() => void send()} disabled={busy || !body.trim()} className="ml-auto">
                <Icon name="share" size={16} />
                {t('ส่งข้อความ')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="-mx-1">
          <p className="mb-3 text-xs text-ink-faint">
            {t('ข้อความถึงทุกคนในแบรนด์นี้ เก็บไว้ 90 วัน — แก้ไขไม่ได้หลังส่ง')}
          </p>
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-faint">{t('ยังไม่มีข้อความ')}</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((m) => {
                const mine = m.byUserId === user.id
                return (
                  <li key={m.id} className={`rounded-xl border p-3 ${m.pinned ? 'border-warn/40 bg-warn-soft/50' : 'border-line bg-surface'}`}>
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">
                        {m.byUserName.charAt(0).toUpperCase() || '?'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{m.byUserName}</span>
                      {m.pinned && <Icon name="pin" size={14} className="shrink-0 text-warn" />}
                      <span className="num shrink-0 text-xs text-ink-faint" title={formatThaiDateTime(m.createdAt)}>
                        {bkkTimeOf(m.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink">{m.body}</p>
                    <div className="mt-1.5 flex items-center gap-3 text-xs">
                      <span className="text-ink-faint">{formatThaiDateTime(m.createdAt)}</span>
                      {manager && (
                        <button type="button" onClick={() => void pin(m, !m.pinned)} className="text-brand hover:underline">
                          {m.pinned ? t('เลิกปักหมุด') : t('ปักหมุด')}
                        </button>
                      )}
                      {(mine || user.role === 'admin') && (
                        <button type="button" onClick={() => void remove(m)} className="text-danger hover:underline">
                          {t('ลบ')}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              const next = days + 30
              setDays(next)
              void load(next, true)
            }}
            className="mt-3 min-h-11 w-full rounded-lg border border-line text-sm text-ink-soft hover:bg-sunken"
          >
            {t('โหลดข้อความเก่ากว่านี้ ({n} วัน)', { n: days })}
          </button>
        </div>
      </Modal>
    </>
  )
}
