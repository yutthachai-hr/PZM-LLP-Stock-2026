import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import { updateUserProfile, changeOwnPassword } from '../services/users'
import { Button, Field, Input, Modal } from './ui'
import { useToast } from './Toast'

/**
 * "Edit my own profile" (owner, 22 Sep 2026) — everything a signed-in account may change
 * about itself without an admin: the display name every screen signs its work with
 * (received/issued/adjusted by, PO "ผู้สั่ง", cost history "by"), and its own password.
 *
 * Deliberately NOT here: email (tied to the Firebase Auth account — changing it needs its
 * own verification flow, a separate piece of work) and role/active (the access model,
 * admin-only by design — see firestore.rules `users/{uid}`). Those stay in Settings →
 * ผู้ใช้งาน for an admin to change about someone else, or aren't self-service at all.
 */
export function ProfileModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [savingName, setSavingName] = useState(false)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  if (!user) return null
  const role = user.role === 'admin' ? t('ผู้ดูแลระบบ') : user.role === 'manager' ? t('หัวหน้า') : t('พนักงาน')
  const nameChanged = name.trim() !== user.name && name.trim().length > 0

  async function saveName() {
    setSavingName(true)
    try {
      await updateUserProfile(user!.id, { name: name.trim() })
      toast.success(t('บันทึกชื่อแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setSavingName(false)
    }
  }

  async function savePassword() {
    if (!currentPw || !newPw) return toast.error(t('กรอกรหัสผ่านปัจจุบันและรหัสผ่านใหม่'))
    if (newPw.length < 6) return toast.error(t('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร'))
    if (newPw !== confirmPw) return toast.error(t('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน'))
    setSavingPw(true)
    try {
      await changeOwnPassword({ id: user!.id, email: user!.email, currentPassword: currentPw, newPassword: newPw })
      toast.success(t('เปลี่ยนรหัสผ่านแล้ว'))
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setSavingPw(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('โปรไฟล์ของฉัน')} compact>
      <div className="space-y-6">
        <div className="space-y-3">
          <Field label={t('ชื่อที่แสดง')} hint={t('ชื่อนี้ขึ้นในเอกสารทุกจุดที่คุณเป็นคนทำรายการ')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
          <div className="flex justify-end">
            <Button size="sm" onClick={saveName} disabled={savingName || !nameChanged}>
              {savingName ? t('กำลังบันทึก...') : t('บันทึกชื่อ')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-sunken p-3 text-sm">
          <div>
            <div className="text-xs text-ink-faint">{t('อีเมล')}</div>
            <div className="truncate text-ink">{user.email}</div>
          </div>
          <div>
            <div className="text-xs text-ink-faint">{t('สิทธิ์')}</div>
            <div className="text-ink">{role}</div>
          </div>
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-ink">{t('เปลี่ยนรหัสผ่าน')}</h3>
          <Field label={t('รหัสผ่านปัจจุบัน')} required>
            <Input type="password" autoComplete="current-password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
          </Field>
          <Field label={t('รหัสผ่านใหม่')} required hint={t('อย่างน้อย 6 ตัวอักษร')}>
            <Input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </Field>
          <Field label={t('ยืนยันรหัสผ่านใหม่')} required>
            <Input type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={savePassword} disabled={savingPw}>
              {savingPw ? t('กำลังบันทึก...') : t('เปลี่ยนรหัสผ่าน')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
