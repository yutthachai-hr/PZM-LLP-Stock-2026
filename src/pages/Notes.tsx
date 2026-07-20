import { useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { Button, Card, EmptyState, Field, Input, Modal, Textarea } from '../components/ui'
import { createNote, updateNote, deleteNote } from '../services/notes'
import { formatThaiDateTime } from '../lib/format'
import type { Note } from '../types'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'

export function NotesPage() {
  const t = useT()
  const { notes } = useData()
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()

  const [editing, setEditing] = useState<Note | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...notes]
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  }, [notes, search])

  async function togglePin(n: Note) {
    await updateNote(n.id, { pinned: !n.pinned })
  }

  async function remove(n: Note) {
    const ok = await confirm({
      title: t("ลบบันทึก"),
      message: t('ลบ "{title}" ?', { title: n.title }),
      danger: true,
      confirmText: t("ลบ"),
    })
    if (!ok) return
    await deleteNote(n.id)
    toast.success(t("ลบแล้ว"))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("📝 บันทึกช่วยจำ")}</h1>
          <p className="text-sm text-slate-500">{t("จดบันทึกเล็กๆ น้อยๆ หรือเรื่องสำคัญ เรียกดูได้ทุกเครื่อง")}</p>
        </div>
        <Button onClick={() => setCreating(true)}>{t("+ บันทึกใหม่")}</Button>
      </div>

      <Input
        placeholder={t("🔍 ค้นหาบันทึก...")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {sorted.length === 0 ? (
        <Card>
          <EmptyState icon="📝" title={t("ยังไม่มีบันทึก")} hint={t("กด “บันทึกใหม่” เพื่อเริ่ม")} />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((n) => (
            <Card key={n.id} className={`flex flex-col p-4 ${n.pinned ? 'border-amber-300 bg-amber-50/40' : ''}`}>
              <div className="mb-1 flex items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-800">{n.title}</h3>
                <button
                  onClick={() => togglePin(n)}
                  className="text-lg"
                  title={n.pinned ? t("เลิกปักหมุด") : t("ปักหมุด")}
                >
                  {n.pinned ? '📌' : '📍'}
                </button>
              </div>
              <p className="flex-1 whitespace-pre-wrap text-sm text-slate-600">{n.body}</p>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-400">
                <span>
                  {n.byUserName} · {formatThaiDateTime(n.updatedAt)}
                </span>
                <span className="flex gap-2">
                  <button onClick={() => setEditing(n)} className="text-slate-500 hover:text-slate-700">
                    {t("แก้ไข")}
                  </button>
                  <button onClick={() => remove(n)} className="text-rose-500 hover:text-rose-700">
                    {t("ลบ")}
                  </button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <NoteEditor
          note={editing}
          userName={user?.name ?? ''}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function NoteEditor({
  note,
  userName,
  onClose,
}: {
  note: Note | null
  userName: string
  onClose: () => void
}) {
  const t = useT()
  const toast = useToast()
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!body.trim() && !title.trim()) return toast.error(t("กรุณาใส่เนื้อหา"))
    setBusy(true)
    try {
      if (note) {
        await updateNote(note.id, { title, body })
      } else {
        await createNote(title, body, userName)
      }
      toast.success(t("บันทึกแล้ว"))
      onClose()
    } catch (e) {
      toast.error(t("บันทึกไม่สำเร็จ:") + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={note ? t("แก้ไขบันทึก") : t("บันทึกใหม่")}>
      <div className="space-y-4">
        <Field label={t("หัวข้อ")}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("เช่น สั่งชีสเพิ่ม")} />
        </Field>
        <Field label={t("เนื้อหา")}>
          <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("ยกเลิก")}
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? t("กำลังบันทึก...") : t("บันทึก")}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
