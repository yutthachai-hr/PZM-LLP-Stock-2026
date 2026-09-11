import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Button, Card, Field, Input } from '../components/ui'
import { isDemoMode, parseConfigInput, saveFirebaseConfig } from '../firebase/config'
import { useT } from '../i18n/I18nContext'
import { LangToggle } from '../i18n/LangToggle'
import { IDLE_MINUTES } from '../auth/useIdleLogout'

export function LoginPage() {
  const t = useT()
  const { login, signUp, needsBootstrap, mode, notice } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showCloud, setShowCloud] = useState(false)
  const [cfgText, setCfgText] = useState('')
  const [cfgErr, setCfgErr] = useState('')

  function connectCloud() {
    const parsed = parseConfigInput(cfgText)
    if (!parsed) {
      setCfgErr(t('อ่านค่า config ไม่ได้ — วางทั้งอ็อบเจกต์ { apiKey: ..., projectId: ..., appId: ... }'))
      return
    }
    saveFirebaseConfig(parsed)
    setTimeout(() => window.location.reload(), 500)
  }

  const [wantRegister, setWantRegister] = useState(false)
  // Local mode's first account really does become the admin. In cloud mode, signing up
  // only ever creates a staff account waiting for approval — whoever you are — so the
  // copy must not promise otherwise.
  const firstAdmin = needsBootstrap && mode === 'local'
  const bootstrap = firstAdmin || wantRegister

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (bootstrap) {
        await signUp(name, email, password)
      } else {
        await login(email, password)
      }
    } catch (err) {
      setError(humanError(err))
    } finally {
      setBusy(false)
    }
  }

  // Sign-in and brand choice happen before a brand is picked, so there is no brand
  // accent to use yet. The gradient is deliberately both brands at once — Pizza Mania
  // red into Le Lapin orange — rather than a token.
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 p-4">
      <Card className="w-full max-w-sm p-6">
        <LangToggle className="mx-auto mb-4 w-32" />
        <div className="mb-6 text-center">
          {/* The installed icon, not an emoji: this is the screen someone lands on after
              tapping that icon on their home screen, and it should be the same mark. */}
          <img
            src="/pwa-192.png"
            alt=""
            width={56}
            height={56}
            className="mx-auto rounded-xl"
          />
          <h1 className="mt-2 text-xl font-bold text-brand">Inventory Pzm</h1>
          <p className="text-sm text-ink-soft">
            {!bootstrap
              ? t("เข้าสู่ระบบบริหารสต๊อก")
              : firstAdmin
                ? t("ตั้งค่าผู้ดูแลระบบคนแรก")
                : t("ขอสิทธิ์เข้าใช้งาน")}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {bootstrap && (
            <Field label={firstAdmin ? t("ชื่อผู้ดูแล") : t("ชื่อของคุณ")} required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("เช่น สมชาย")}
                required
              />
            </Field>
          )}
          <Field label={t("อีเมล")} required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              autoComplete="username"
              required
            />
          </Field>
          <Field label={t("รหัสผ่าน")} required hint={bootstrap ? t("อย่างน้อย 6 ตัวอักษร") : undefined}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={bootstrap ? 'new-password' : 'current-password'}
              minLength={6}
              required
            />
          </Field>

          {bootstrap && !firstAdmin && (
            <p className="rounded-lg bg-sunken px-3 py-2 text-xs text-ink-soft">
              {t("บัญชีใหม่จะยังเข้าใช้ข้อมูลไม่ได้จนกว่าผู้ดูแลระบบจะอนุมัติ")}
            </p>
          )}
          {notice && !error && (
            <div className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              {t(notice, { minutes: IDLE_MINUTES })}
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{t(error)}</div>
          )}

          <Button type="submit" disabled={busy} className="w-full">
            {busy
              ? t("กำลังดำเนินการ...")
              : !bootstrap
                ? t("เข้าสู่ระบบ")
                : firstAdmin
                  ? t("สร้างบัญชีผู้ดูแล")
                  : t("ส่งคำขอเข้าใช้งาน")}
          </Button>
        </form>

        {mode === 'cloud' && (
          <button
            type="button"
            onClick={() => {
              setWantRegister((v) => !v)
              setError('')
            }}
            className="mt-3 block w-full text-center text-xs text-brand hover:underline"
          >
            {bootstrap ? t("มีบัญชีอยู่แล้ว? เข้าสู่ระบบ") : t("ยังไม่มีบัญชี? ขอสิทธิ์เข้าใช้งาน")}
          </button>
        )}

        <p className="mt-4 text-center text-xs text-ink-faint">
          {mode === 'cloud'
            ? t("โหมด Cloud — ข้อมูลซิงก์ทุกเครื่องแบบเรียลไทม์")
            : t("โหมดในเครื่อง — ข้อมูลเก็บในเบราว์เซอร์นี้")}
        </p>

        {/* Not in a demo build: getFirebaseConfig() ignores a saved config there, so the
            panel would take a real project's keys and then appear to do nothing. */}
        {mode === 'local' && !isDemoMode() && (
          <div className="mt-3 border-t border-line pt-3">
            {!showCloud ? (
              <button
                onClick={() => setShowCloud(true)}
                className="mx-auto block text-xs text-brand hover:underline"
              >
                {t("เชื่อมต่อ Cloud (ใช้หลายเครื่อง real-time)")}
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-ink-soft">
                  {t("วางค่า")} <span className="font-mono">firebaseConfig</span> {t("จาก Firebase Console:")}
                </p>
                <textarea
                  className="w-full rounded-lg border border-line-strong p-2 font-mono text-xs"
                  rows={6}
                  placeholder={'{\n  "apiKey": "...",\n  "authDomain": "xxx.firebaseapp.com",\n  "projectId": "xxx",\n  "appId": "..."\n}'}
                  value={cfgText}
                  onChange={(e) => setCfgText(e.target.value)}
                />
                {cfgErr && <p className="text-xs text-danger">{cfgErr}</p>}
                <div className="flex gap-2">
                  <Button onClick={connectCloud} className="flex-1">
                    {t("เชื่อมต่อ Cloud")}
                  </Button>
                  <Button variant="secondary" onClick={() => setShowCloud(false)}>
                    {t("ยกเลิก")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

/**
 * Turns a Firebase auth code into a translation key. The caller runs the result through
 * t() — an unrecognised error falls through as its own message, which t() passes on
 * unchanged.
 */
function humanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password'))
    return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' // i18n-key
  if (msg.includes('auth/user-not-found')) return 'ไม่พบบัญชีนี้' // i18n-key
  if (msg.includes('auth/email-already-in-use')) return 'อีเมลนี้ถูกใช้แล้ว' // i18n-key
  if (msg.includes('auth/weak-password')) return 'รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัว)' // i18n-key
  if (msg.includes('auth/invalid-email')) return 'รูปแบบอีเมลไม่ถูกต้อง' // i18n-key
  return msg
}
