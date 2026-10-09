import { useRef, useState, type CSSProperties } from 'react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { useAuth } from '../auth/AuthContext'
import { BRANDS, brandDef, type BrandId } from '../brand/brand'
import { Button } from '../components/ui'
import { Icon } from '../components/Icon'
import { getAuthInstance } from '../firebase/app'
import { isDemoMode, parseConfigInput, saveFirebaseConfig } from '../firebase/config'
import { resetDemoData } from '../services/demoSeed'
import { DEMO_ADMIN, DEMO_USERS } from '../services/demoUsers'
import { errText } from '../i18n/AppError'
import { useT } from '../i18n/I18nContext'
import { LangMenu } from '../i18n/LangMenu'

/**
 * Brand-specific copy, short names, and static mascot artwork.
 * Static artwork cut from official designs (owner directive, 9 Oct 2026).
 * No animations, no rigs, no floating loops.
 */
const LOOK: Record<BrandId, { short: string; tagline: string; art: string; artClass: string }> = {
  pizza: {
    short: 'Pizza Mania',
    tagline: 'จัดการวัตถุดิบ ติดตามสต๊อก ให้ครัวเดินได้ไม่สะดุด', // i18n-key
    art: '/login/pizza-mania.webp',
    artClass: 'lg:max-w-[310px]',
  },
  lelapin: {
    short: 'Le Lapin',
    tagline: 'จัดการสต๊อก ติดตามวัตถุดิบ ให้ทุกสาขาเดินได้ราบรื่น', // i18n-key
    art: '/login/le-lapin.webp',
    artClass: 'lg:max-w-[420px]',
  },
  rnd: {
    short: 'R&D',
    tagline: 'คิดค้นสูตร ทดลองวัตถุดิบ และติดตามต้นทุนของทุกการทดลอง', // i18n-key
    art: '/login/rnd.webp',
    artClass: 'lg:max-w-[310px]',
  },
}

export function LoginPage() {
  const t = useT()
  const { login, signUp, needsBootstrap, mode, notice } = useAuth()
  const [brand, setBrand] = useState<BrandId>('pizza')
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
      if (String(err).includes('auth/user-not-found')) {
        setInfo(t('ถ้าอีเมลนี้มีบัญชีอยู่ ระบบส่งลิงก์ตั้งรหัสผ่านใหม่ไปแล้ว — เช็กกล่องจดหมาย (และโฟลเดอร์สแปม)'))
      } else {
        setError(humanError(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const vars = {
    '--color-brand': def.accent,
    '--color-brand-soft': def.accentSoft,
    '--color-brand-vivid': def.accentVivid,
  } as CSSProperties

  return (
    <div style={vars} className="relative min-h-screen overflow-x-hidden bg-[#fffdfc] text-ink antialiased">
      {/* ---- Header: Platform identity + compact theme switcher + Globe language ---- */}
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-y-3 px-4 pt-4 sm:px-8 lg:px-12 lg:pt-6">
        <div className="flex items-center gap-2.5">
          <img
            src="/pwa-192.png"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 rounded-xl object-cover shadow-xs"
          />
          <div className="leading-tight">
            <div className="text-sm font-extrabold tracking-tight text-ink sm:text-base">Inventory OS</div>
            <div className="text-[11px] text-ink-soft">The Inventory OS</div>
          </div>
        </div>

        {/* Mobile: LangMenu top right */}
        <div className="sm:hidden">
          <LangMenu />
        </div>

        {/* Brand Theme Selector: centered on mobile, inline on desktop */}
        <div className="order-last flex w-full justify-center sm:order-none sm:w-auto">
          <BrandSwitch brand={brand} onChange={setBrand} />
        </div>

        {/* Desktop: LangMenu on far right */}
        <div className="hidden sm:block">
          <LangMenu />
        </div>
      </header>

      {/* ---- Main content: Hero & Login Card ---- */}
      <main className="mx-auto grid w-full max-w-6xl items-center gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(390px,440px)] lg:gap-12 lg:px-12 lg:py-10">
        {/* Left: Hero area with brand copy and anchored static mascot */}
        <section className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:gap-6 lg:flex lg:flex-col lg:items-start lg:text-left">
          <div className="min-w-0">
            <div
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: def.accentSoft, color: def.accent }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: def.accentVivid }} />
              {look.short}
            </div>

            <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl lg:mt-3 lg:text-5xl lg:leading-[1.15]">
              {t('เข้าสู่ระบบ')}{' '}
              <span style={{ color: def.accent }}>{look.short}</span>
            </h1>

            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-ink-soft sm:mt-2.5 sm:text-sm lg:text-base">
              {t(look.tagline)}
            </p>
          </div>

          {/* Mascot: side-by-side compact on mobile, large anchored below on lg+ */}
          <div className="shrink-0 lg:mt-6 lg:w-full">
            <div className={`relative mx-auto max-w-[125px] sm:max-w-[190px] ${look.artClass} lg:mx-0`}>
              <img
                src={look.art}
                alt=""
                draggable={false}
                className="pointer-events-none h-auto w-full select-none object-contain"
              />
            </div>
          </div>
        </section>

        {/* Right: Login Card */}
        <section className="w-full rounded-3xl border border-line/70 bg-surface p-6 shadow-[0_24px_60px_-28px_rgb(0_0_0/0.18)] sm:p-8">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
            {!bootstrap ? t('เข้าสู่ระบบ') : firstAdmin ? t('ตั้งค่าผู้ดูแลระบบคนแรก') : t('ขอสิทธิ์เข้าใช้งาน')}
          </h2>
          <p className="mt-1 text-xs text-ink-soft sm:text-sm">
            {t('ยินดีต้อนรับกลับสู่ {name} Stock', { name: look.short })}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {bootstrap && (
              <div>
                <label htmlFor="login-name" className="mb-1 block text-xs font-semibold text-ink-soft">
                  {firstAdmin ? t('ชื่อผู้ดูแล') : t('ชื่อของคุณ')}
                </label>
                <div className="relative flex items-center">
                  <Icon name="user" size={18} className="pointer-events-none absolute left-3.5 text-ink-soft" />
                  <input
                    id="login-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={firstAdmin ? t('ชื่อผู้ดูแล') : t('ชื่อของคุณ')}
                    required
                    className="h-12 w-full rounded-xl border border-line bg-surface pl-10 pr-3 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 placeholder:text-ink-faint"
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="login-email" className="mb-1 block text-xs font-semibold text-ink-soft">
                {t('อีเมล')}
              </label>
              <div className="relative flex items-center">
                <Icon name="user" size={18} className="pointer-events-none absolute left-3.5 text-ink-soft" />
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('อีเมล')}
                  autoComplete="username"
                  required
                  className="h-12 w-full rounded-xl border border-line bg-surface pl-10 pr-3 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 placeholder:text-ink-faint"
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="login-password" className="text-xs font-semibold text-ink-soft">
                  {t('รหัสผ่าน')}
                </label>
                {!bootstrap && (
                  <button
                    type="button"
                    onClick={() => void forgot()}
                    disabled={busy}
                    className="cursor-pointer text-xs font-medium text-brand hover:underline"
                  >
                    {t('ลืมรหัสผ่าน?')}
                  </button>
                )}
              </div>
              <div className="relative flex items-center">
                <Icon name="lock" size={18} className="pointer-events-none absolute left-3.5 text-ink-soft" />
                <input
                  id="login-password"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('รหัสผ่าน')}
                  autoComplete={bootstrap ? 'new-password' : 'current-password'}
                  minLength={6}
                  required
                  className="h-12 w-full rounded-xl border border-line bg-surface pl-10 pr-11 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 placeholder:text-ink-faint"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? t('ซ่อนรหัสผ่าน') : t('แสดงรหัสผ่าน')}
                  aria-pressed={showPw}
                  className="absolute right-3 flex h-8 w-8 cursor-pointer items-center justify-center text-ink-soft hover:text-ink"
                >
                  <Icon name={showPw ? 'eyeOff' : 'eye'} size={18} />
                </button>
              </div>
            </div>

            {bootstrap && <p className="text-xs text-ink-faint">{t('อย่างน้อย 6 ตัวอักษร')}</p>}

            {bootstrap && !firstAdmin && (
              <p className="rounded-lg bg-sunken px-3 py-2 text-xs text-ink-soft">
                {t('บัญชีใหม่จะยังเข้าใช้ข้อมูลไม่ได้จนกว่าผู้ดูแลระบบจะอนุมัติ')}
              </p>
            )}

            {notice && !error && (
              <div role="status" className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
                {t(notice)}
              </div>
            )}
            {info && !error && (
              <div role="status" className="rounded-lg bg-in-soft px-3 py-2 text-xs text-in">
                {info}
              </div>
            )}
            {error && (
              <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
                {t(error)}
              </div>
            )}

            <Button type="submit" disabled={busy} className="!h-12 w-full !rounded-xl !text-sm !font-bold">
              {busy
                ? t('กำลังดำเนินการ...')
                : !bootstrap
                  ? t('เข้าสู่ระบบ')
                  : firstAdmin
                    ? t('สร้างบัญชีผู้ดูแล')
                    : t('ส่งคำขอเข้าใช้งาน')}
              {!busy && <Icon name="arrowRight" size={16} />}
            </Button>
          </form>

          {mode === 'cloud' && (
            <p className="mt-5 text-center text-xs text-ink-soft">
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

          <p className="mt-4 text-center text-[11px] text-ink-faint">
            {mode === 'cloud'
              ? t('โหมด Cloud — ข้อมูลซิงก์ทุกเครื่องแบบเรียลไทม์')
              : t('โหมดในเครื่อง — ข้อมูลเก็บในเบราว์เซอร์นี้')}
          </p>

          {/* Collapsible Demo mode panel for QA testing */}
          {isDemoMode() && <DemoSection />}

          {/* Local mode Cloud connector */}
          {mode === 'local' && !isDemoMode() && (
            <div className="mt-3 border-t border-line pt-3">
              {!showCloud ? (
                <button
                  onClick={() => setShowCloud(true)}
                  className="mx-auto block cursor-pointer text-xs text-brand hover:underline"
                >
                  {t('เชื่อมต่อ Cloud (ใช้หลายเครื่อง real-time)')}
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-ink-soft">
                    {t('วางค่า')} <span className="font-mono">firebaseConfig</span> {t('จาก Firebase Console:')}
                  </p>
                  <textarea
                    className="w-full rounded-lg border border-line-strong p-2 font-mono text-xs outline-none focus:border-brand"
                    rows={6}
                    placeholder={
                      '{\n  "apiKey": "...",\n  "authDomain": "xxx.firebaseapp.com",\n  "projectId": "xxx",\n  "appId": "..."\n}'
                    }
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

/**
 * Compact brand theme selector. Keyboard accessible radiogroup.
 * Does not duplicate selected-brand logo in the header.
 */
function BrandSwitch({ brand, onChange }: { brand: BrandId; onChange: (b: BrandId) => void }) {
  const t = useT()
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])

  const move = (dir: number) => {
    const idx = BRANDS.findIndex((b) => b.id === brand)
    const nextIdx = (idx + dir + BRANDS.length) % BRANDS.length
    onChange(BRANDS[nextIdx].id)
    btnRefs.current[nextIdx]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('แบรนด์')}
      className="flex items-center gap-1 rounded-full border border-line bg-surface p-1 shadow-xs"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        }
      }}
    >
      {BRANDS.map((b, i) => {
        const active = b.id === brand
        return (
          <button
            key={b.id}
            ref={(el) => {
              btnRefs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={b.name}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(b.id)}
            className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
              active
                ? 'bg-brand text-white shadow-xs'
                : 'text-ink-soft hover:bg-sunken hover:text-ink'
            }`}
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: active ? '#ffffff' : b.accentVivid }}
            />
            <span>{LOOK[b.id].short}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Collapsible demo setup panel.
 * Kept outside normal primary flow via details/summary to avoid cluttering normal login.
 */
function DemoSection() {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function reset() {
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
    <details className="mt-4 rounded-xl border border-warn/30 bg-warn-soft/30 p-2.5 text-xs text-ink">
      <summary className="flex cursor-pointer items-center justify-between font-semibold select-none outline-none focus-visible:underline">
        <span className="flex items-center gap-1.5">
          <Icon name="info" size={14} className="text-warn" />
          {t('โหมดสาธิต')}
        </span>
        <Icon name="chevronDown" size={13} className="text-ink-soft" />
      </summary>
      <div className="mt-2.5 space-y-2 border-t border-warn/20 pt-2.5">
        <p className="text-[11px] leading-relaxed text-ink-soft">
          {t('ลบข้อมูลในเครื่องนี้ทั้งหมด แล้วตั้งค่าใหม่: ผู้ใช้ 3 บทบาท, คลังทั้งสองแบรนด์, และแคตตาล็อกสินค้า')}
        </p>
        <Button variant="secondary" size="sm" onClick={reset} disabled={busy} className="w-full" type="button">
          {busy ? t('กำลังเตรียม...') : t('รีเซ็ตข้อมูลเดโม')}
        </Button>
        <p className="text-[11px] text-ink-faint">
          {t('เข้าสู่ระบบอัตโนมัติ — บัญชี {email} รหัส {password}', {
            email: DEMO_ADMIN.email,
            password: DEMO_ADMIN.password,
          })}
        </p>
        <p className="text-[11px] text-ink-faint">
          {t('ทดลองสิทธิ์อื่นได้ด้วยรหัสเดียวกัน: {others}', {
            others: DEMO_USERS.filter((u) => u.email !== DEMO_ADMIN.email)
              .map((u) => `${u.email} (${u.name})`)
              .join(' · '),
          })}
        </p>
        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
    </details>
  )
}

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
