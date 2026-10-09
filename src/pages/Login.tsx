import { useState, type CSSProperties } from 'react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { useAuth } from '../auth/AuthContext'
import { brandDef, lastBrand, type BrandId } from '../brand/brand'
import { Button } from '../components/ui'
import { Icon, type IconName } from '../components/Icon'
import { AnimatedMascot } from '../components/login/AnimatedMascot'
import { LoginScenery } from '../components/login/LoginScenery'
import { getAuthInstance } from '../firebase/app'
import { isDemoMode, parseConfigInput, saveFirebaseConfig } from '../firebase/config'
import { resetDemoData } from '../services/demoSeed'
import { DEMO_ADMIN, DEMO_USERS } from '../services/demoUsers'
import { errText } from '../i18n/AppError'
import { useT } from '../i18n/I18nContext'
import { LangToggle } from '../i18n/LangToggle'

/**
 * The words under each brand's heading, and its short name — the owner's mock-ups say
 * "Pizza Mania Stock" and "Le Lapin Stock".
 */
const LOOK: Record<BrandId, { short: string; tagline: string }> = {
  pizza: { short: 'Pizza Mania', tagline: 'จัดการวัตถุดิบ ติดตามสต๊อก ให้ครัวเดินได้ไม่สะดุด' }, // i18n-key
  lelapin: { short: 'Le Lapin', tagline: 'จัดการสต๊อก ติดตามวัตถุดิบ ให้ทุกสาขาเดินได้ราบรื่น' }, // i18n-key
  // R&D came after the mascots were drawn: it gets its own logo, standing still, never another
  // brand's figure (owner, 9 Oct 2026).
  rnd: { short: 'R&D', tagline: 'ทดลองสูตร พัฒนาเมนู และติดตามวัตถุดิบทดลองในที่เดียว' }, // i18n-key
}

/** Brands with a drawn, rigged mascot. Every other brand shows its logo instead. */
const HAS_MASCOT: readonly BrandId[] = ['pizza', 'lelapin']

/**
 * Sign in, laid out as the owner's mock-ups (5 Oct 2026): the brand's heading and its
 * mascot walking in place, the form in a card beside them. Before anyone signs in there is
 * no brand yet, so the page wears the brand this device used last — Pizza Mania the first
 * time — and a switch at the top changes it. Everything the old screen did is still here:
 * the first admin, asking for access in cloud mode, the demo reset and the cloud link.
 */
export function LoginPage() {
  const t = useT()
  const { login, signUp, needsBootstrap, mode, notice } = useAuth()
  const [brand, setBrand] = useState<BrandId>(() => lastBrand())
  const def = brandDef(brand)
  const look = LOOK[brand]
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
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
    setInfo('')
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

  /**
   * "Forgot password" (owner, 5 Oct 2026): Firebase mails a reset link, free. The answer is
   * the same whether or not the address has an account, so the screen cannot be used to
   * find out who works here. A local or demo build has no mail to send.
   */
  async function forgot() {
    setError('')
    setInfo('')
    if (mode !== 'cloud') return setInfo(t('โหมดในเครื่องส่งอีเมลไม่ได้ — ให้ผู้ดูแลระบบตั้งรหัสผ่านใหม่ให้'))
    const em = email.trim()
    if (!em) return setError(t('ใส่อีเมลก่อน แล้วกด "ลืมรหัสผ่าน?" อีกครั้ง'))
    setBusy(true)
    try {
      await sendPasswordResetEmail(getAuthInstance(), em)
      setInfo(t('ถ้าอีเมลนี้มีบัญชีอยู่ ระบบส่งลิงก์ตั้งรหัสผ่านใหม่ไปแล้ว — เช็กกล่องจดหมาย (และโฟลเดอร์สแปม)'))
    } catch (err) {
      // An unknown address is answered like a known one, for the reason above.
      if (String(err).includes('auth/user-not-found')) setInfo(t('ถ้าอีเมลนี้มีบัญชีอยู่ ระบบส่งลิงก์ตั้งรหัสผ่านใหม่ไปแล้ว — เช็กกล่องจดหมาย (และโฟลเดอร์สแปม)'))
      else setError(humanError(err))
    } finally {
      setBusy(false)
    }
  }

  // The page takes the chosen brand's colours itself: the app sets them only after a brand
  // is picked, which is after this screen.
  const vars = {
    // The utilities' own variables: --color-brand is worked out once on :root, so setting
    // --brand-accent here would not reach it.
    '--color-brand': def.accent,
    '--color-brand-soft': def.accentSoft,
    '--color-brand-vivid': def.accentVivid,
  } as CSSProperties

  return (
    <div style={vars} className="relative min-h-screen overflow-x-hidden bg-[#fffdfc] text-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-8 lg:px-14 lg:pt-8">
        <div className="flex items-center gap-3">
          <img src={def.logo} alt="" width={52} height={52} className="h-12 w-12 rounded-full object-cover sm:h-13 sm:w-13" />
          <div className="leading-tight">
            <div className="text-lg font-extrabold tracking-tight text-brand-vivid sm:text-xl">{look.short.toUpperCase()}</div>
            <div className="text-xs text-ink-soft">The Inventory OS</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label={t('แบรนด์')} className="flex rounded-full border border-line bg-surface p-0.5 text-xs">
            {(['pizza', 'lelapin', 'rnd'] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBrand(b)}
                aria-pressed={brand === b}
                className={`cursor-pointer rounded-full px-3 py-1.5 font-semibold transition-colors ${
                  brand === b ? 'bg-brand text-white' : 'text-ink-soft hover:text-ink'
                }`}
              >
                {LOOK[b].short}
              </button>
            ))}
          </div>
          <LangToggle className="w-28" />
        </div>
      </header>

      <main className="mx-auto grid max-w-[1400px] items-center gap-6 px-5 pb-10 pt-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(380px,440px)] lg:gap-10 lg:px-14 lg:pt-4">
        {/* ---- the brand and its mascot ---- */}
        {/* On a phone, or a screen with little height, the figure stands beside the heading and
            stays small, so the form is still on the first screen. */}
        <section className="relative grid grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)] items-center gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-4">
          <div className="relative z-10">
            <span className="mb-3 block h-1 w-12 rounded-full bg-brand-vivid sm:mb-5" aria-hidden="true" />
            <h1 className="text-[1.7rem] font-extrabold leading-[1.1] tracking-tight min-[400px]:text-3xl sm:text-5xl">
              {t('เข้าสู่ระบบ')}
              <br />
              <span className="text-brand-vivid">{look.short}</span> Stock
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft sm:mt-4 sm:text-base">{t(look.tagline)}</p>
          </div>
          <div className="relative mx-auto w-full max-w-[220px] sm:max-w-[300px] md:max-w-[380px] [@media(max-height:560px)]:max-w-[170px]">
            {HAS_MASCOT.includes(brand) ? (
              <>
                {/* The brand's scene behind the figure, its ground line on the mascot's. */}
                <LoginScenery
                  brand={brand}
                  className="pointer-events-none absolute left-[-20%] w-[140%]"
                  style={{ bottom: brand === 'pizza' ? '-2.3%' : '1.5%' }}
                />
                <AnimatedMascot brand={brand} className="relative w-full" />
              </>
            ) : (
              // A brand without a mascot: its own logo, still, on a soft disc in its colours.
              <div className="relative flex aspect-square w-full items-center justify-center" aria-hidden="true">
                <div className="absolute inset-[6%] rounded-full bg-brand-soft" />
                <div className="absolute inset-[16%] rounded-full border-2 border-brand/20" />
                <img src={def.logo} alt="" width={320} height={320} className="relative h-[62%] w-[62%] rounded-full object-contain shadow-[0_18px_40px_-20px_rgb(0_0_0/0.35)]" />
              </div>
            )}
          </div>
        </section>

        {/* ---- the form ---- */}
        <section className="w-full rounded-3xl border border-line/70 bg-surface p-6 shadow-[0_24px_60px_-28px_rgb(0_0_0/0.25)] sm:p-9">
          <h2 className="text-3xl font-extrabold tracking-tight">
            {!bootstrap ? t('เข้าสู่ระบบ') : firstAdmin ? t('ตั้งค่าผู้ดูแลระบบคนแรก') : t('ขอสิทธิ์เข้าใช้งาน')}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">{t('ยินดีต้อนรับกลับสู่ {name} Stock', { name: look.short })}</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {bootstrap && (
              <IconInput
                icon="user"
                value={name}
                onChange={setName}
                placeholder={firstAdmin ? t('ชื่อผู้ดูแล') : t('ชื่อของคุณ')}
                required
              />
            )}
            <IconInput
              icon="user"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder={t('อีเมล')}
              autoComplete="username"
              required
            />
            <IconInput
              icon="lock"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={setPassword}
              placeholder={t('รหัสผ่าน')}
              autoComplete={bootstrap ? 'new-password' : 'current-password'}
              minLength={6}
              required
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? t('ซ่อนรหัสผ่าน') : t('แสดงรหัสผ่าน')}
                  aria-pressed={showPw}
                  className="flex h-full w-12 cursor-pointer items-center justify-center text-ink-soft hover:text-ink"
                >
                  <Icon name={showPw ? 'eyeOff' : 'eye'} size={19} />
                </button>
              }
            />
            {bootstrap ? (
              <p className="text-xs text-ink-faint">{t('อย่างน้อย 6 ตัวอักษร')}</p>
            ) : (
              <div className="flex justify-end">
                <button type="button" onClick={() => void forgot()} disabled={busy} className="cursor-pointer text-sm text-brand hover:underline">
                  {t('ลืมรหัสผ่าน?')}
                </button>
              </div>
            )}

            {bootstrap && !firstAdmin && (
              <p className="rounded-lg bg-sunken px-3 py-2 text-xs text-ink-soft">
                {t('บัญชีใหม่จะยังเข้าใช้ข้อมูลไม่ได้จนกว่าผู้ดูแลระบบจะอนุมัติ')}
              </p>
            )}
            {notice && !error && <div className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{t(notice)}</div>}
            {info && !error && <div className="rounded-lg bg-in-soft px-3 py-2 text-sm text-in">{info}</div>}
            {error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{t(error)}</div>}

            <Button type="submit" disabled={busy} className="!h-13 w-full !rounded-xl !text-base">
              {busy
                ? t('กำลังดำเนินการ...')
                : !bootstrap
                  ? t('เข้าสู่ระบบ')
                  : firstAdmin
                    ? t('สร้างบัญชีผู้ดูแล')
                    : t('ส่งคำขอเข้าใช้งาน')}
              {!busy && <Icon name="arrowRight" size={18} />}
            </Button>
          </form>

          {mode === 'cloud' && (
            <p className="mt-5 text-center text-sm text-ink-soft">
              {bootstrap ? t('มีบัญชีอยู่แล้ว?') : t('ยังไม่มีบัญชี?')}{' '}
              <button
                type="button"
                onClick={() => {
                  setWantRegister((v) => !v)
                  setError('')
                  setInfo('')
                }}
                className="cursor-pointer font-semibold text-brand hover:underline"
              >
                {bootstrap ? t('เข้าสู่ระบบ') : t('ขอสิทธิ์เข้าใช้งาน')}
              </button>
            </p>
          )}

          <p className="mt-4 text-center text-xs text-ink-faint">
            {mode === 'cloud' ? t('โหมด Cloud — ข้อมูลซิงก์ทุกเครื่องแบบเรียลไทม์') : t('โหมดในเครื่อง — ข้อมูลเก็บในเบราว์เซอร์นี้')}
          </p>

          {isDemoMode() && <DemoSetup />}

          {/* Not in a demo build: getFirebaseConfig() ignores a saved config there, so the
              panel would take a real project's keys and then appear to do nothing. */}
          {mode === 'local' && !isDemoMode() && (
            <div className="mt-3 border-t border-line pt-3">
              {!showCloud ? (
                <button onClick={() => setShowCloud(true)} className="mx-auto block text-xs text-brand hover:underline">
                  {t('เชื่อมต่อ Cloud (ใช้หลายเครื่อง real-time)')}
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-ink-soft">
                    {t('วางค่า')} <span className="font-mono">firebaseConfig</span> {t('จาก Firebase Console:')}
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
                      {t('เชื่อมต่อ Cloud')}
                    </Button>
                    <Button variant="secondary" onClick={() => setShowCloud(false)}>
                      {t('ยกเลิก')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

/** A tall field with its icon inside on the left, as the mock-ups draw them. */
function IconInput({
  icon,
  value,
  onChange,
  trailing,
  ...rest
}: {
  icon: IconName
  value: string
  onChange: (v: string) => void
  trailing?: React.ReactNode
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div className="relative flex h-13 items-center rounded-xl border border-line bg-sunken/70 transition-colors focus-within:border-brand focus-within:bg-surface focus-within:ring-2 focus-within:ring-brand/20">
      <Icon name={icon} size={20} className="ml-4 shrink-0 text-brand" />
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={rest.placeholder}
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-base text-ink outline-none placeholder:text-ink-faint"
      />
      {trailing}
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
  if (msg.includes('auth/too-many-requests')) return 'ลองหลายครั้งเกินไป — รอสักครู่แล้วลองใหม่' // i18n-key
  return msg
}

/**
 * Rebuild the demo from nothing, in one tap, and sign in.
 *
 * It lives on the sign-in screen because that is where a wiped device leaves you: no
 * account exists yet, so there is nowhere else to put a control that creates one. The
 * reload afterwards is not cosmetic — the running app is holding collections that were
 * just deleted out from under it.
 */
function DemoSetup() {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function go() {
    setBusy(true)
    setErr('')
    try {
      await resetDemoData()
      window.location.reload()
    } catch (e) {
      setErr(errText(e, t))
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-warn/30 bg-warn-soft p-3 text-center">
      <p className="text-xs font-medium text-ink">{t('โหมดสาธิต')}</p>
      <p className="mt-0.5 text-xs text-ink-soft">
        {t('ลบข้อมูลในเครื่องนี้ทั้งหมด แล้วตั้งค่าใหม่: ผู้ใช้ 3 บทบาท, คลังทั้งสองแบรนด์, และแคตตาล็อกสินค้า')}
      </p>
      <Button variant="secondary" onClick={go} disabled={busy} className="mt-2 w-full" type="button">
        {busy ? t('กำลังเตรียม...') : t('รีเซ็ตข้อมูลเดโม')}
      </Button>
      <p className="mt-2 text-xs text-ink-faint">
        {t('เข้าสู่ระบบอัตโนมัติ — บัญชี {email} รหัส {password}', {
          email: DEMO_ADMIN.email,
          password: DEMO_ADMIN.password,
        })}
      </p>
      {/* The other two exist so a screen can be tried as the person who actually uses it. */}
      <p className="mt-1 text-xs text-ink-faint">
        {t('ทดลองสิทธิ์อื่นได้ด้วยรหัสเดียวกัน: {others}', {
          others: DEMO_USERS.filter((u) => u.email !== DEMO_ADMIN.email)
            .map((u) => `${u.email} (${u.name})`)
            .join(' · '),
        })}
      </p>
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
    </div>
  )
}
