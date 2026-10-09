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
 * Brand-specific copy, short names, and the static scene behind each brand: the mascot in
 * front of its own shop (Pizza Mania, Le Lapin) or test kitchen (R&D), cut from the owner's
 * approved mock-ups (9 Oct 2026, afternoon). Still pictures: no animation, no rigs, no loops.
 * `focus` keeps the mascot in frame when a narrow screen crops the scene.
 */
const LOOK: Record<BrandId, { short: string; tagline: string; scene: string; w: number; h: number; focus: string }> = {
  pizza: {
    short: 'Pizza Mania',
    tagline: 'จัดการวัตถุดิบ ติดตามสต๊อก ให้ครัวเดินได้ไม่สะดุด', // i18n-key
    scene: '/login/scene-pizza.webp',
    w: 961,
    h: 565,
    focus: '62% 40%',
  },
  lelapin: {
    short: 'Le Lapin',
    tagline: 'จัดการสต๊อก ติดตามวัตถุดิบ ให้ทุกสาขาเดินได้ราบรื่น', // i18n-key
    scene: '/login/scene-lelapin.webp',
    w: 961,
    h: 593,
    focus: '66% 55%',
  },
  rnd: {
    short: 'R&D',
    tagline: 'คิดค้นสูตร ทดลองวัตถุดิบ และติดตามต้นทุนของทุกการทดลอง', // i18n-key
    scene: '/login/scene-rnd.webp',
    w: 961,
    h: 593,
    focus: '55% 40%',
  },
}

/** The scene melts into the page on its right and bottom edges, as in the mock-ups. */
const SCENE_MASK: CSSProperties = {
  maskImage: 'linear-gradient(to right, #000 80%, transparent 100%), linear-gradient(to bottom, #000 84%, transparent 100%)',
  maskComposite: 'intersect',
  WebkitMaskImage: 'linear-gradient(to right, #000 80%, transparent 100%), linear-gradient(to bottom, #000 84%, transparent 100%)',
  WebkitMaskComposite: 'source-in',
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
    '--tabbar-h': '0px',
  } as CSSProperties

  const ambient = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ambient') === '1'
  const legacyFont = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('font') === 'legacy'

  // ponytail: font-login scoped to login container; upgrade to shared design system token if app-wide typography updates.
  return (
    <div style={vars} className={`${legacyFont ? 'font-sans' : 'font-login'} relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-[#fffdfc] text-ink antialiased`}>
      {/* ---- Header: Platform identity + compact theme switcher + Globe language ---- */}
      <header className="mx-auto flex w-full max-w-[1400px] shrink-0 items-center justify-between px-5 pt-4 sm:px-8 lg:px-12 lg:pt-6">
        <div className="flex items-center gap-3 sm:gap-5">
          <div className="flex items-center gap-2.5">
            <img
              src="/pwa-192.png"
              alt=""
              width={34}
              height={34}
              className="h-8.5 w-8.5 rounded-xl object-cover shadow-xs lg:h-10 lg:w-10"
            />
            <span className={`${legacyFont ? '' : 'font-display'} text-base font-bold tracking-tight text-ink sm:text-lg lg:text-xl`}>Inventory OS</span>
          </div>

          <span className="hidden h-6 w-px bg-line/80 sm:block" aria-hidden="true" />

          {/* Desktop: Brand Theme Selector beside platform identity */}
          <div className="hidden sm:block">
            <BrandSwitch brand={brand} onChange={setBrand} />
          </div>
        </div>

        {/* Top right: LangMenu (mobile and desktop) */}
        <div>
          <LangMenu />
        </div>
      </header>

      {/* Mobile only: Brand Theme Selector on row 2, centered */}
      <div className="flex w-full shrink-0 justify-center px-4 pt-2.5 sm:hidden">
        <BrandSwitch brand={brand} onChange={setBrand} />
      </div>

      {/* ---- Main content: Hero & Login Card (vertically centered on desktop, naturally stacked on mobile) ---- */}
      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col justify-start sm:justify-center px-4 py-2 sm:px-8 sm:py-6 sm:pb-8 lg:px-12 lg:py-8">
        <div className="grid w-full items-center gap-3.5 sm:gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(420px,460px)] lg:gap-12 xl:gap-16">
          {/* Left: Brand Hero */}
          <section className="min-w-0">
            <div className="min-w-0">
              <h1 key={brand} className={`brand-heading-in ${legacyFont ? 'font-extrabold' : 'font-display font-bold xl:font-extrabold'} text-[1.75rem] tracking-[-0.02em] text-ink sm:text-4xl lg:text-5xl xl:text-[4.25rem] leading-[1.08] text-balance`}>
                <span style={{ color: def.accent }}>{look.short}</span> Stock
              </h1>

              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-soft sm:text-base lg:mt-3 lg:text-lg xl:text-xl text-pretty">
                {t(look.tagline)}
              </p>
            </div>

            {/* The brand's scene: a short strip on phones (mascot kept in frame), the full picture
                under the heading on wide screens, reaching out to the page's left edge. */}
            <div className="relative mt-2.5 sm:mt-4 lg:-ml-12 lg:mt-5 xl:mt-6">
              {ambient && (
                <div
                  className="pointer-events-none absolute -inset-8 -z-10 rounded-full blur-3xl opacity-25"
                  style={{ background: `radial-gradient(circle, ${def.accentVivid} 0%, transparent 68%)` }}
                  aria-hidden="true"
                />
              )}
              <img
                key={brand}
                src={look.scene}
                alt={look.short}
                width={look.w}
                height={look.h}
                draggable={false}
                style={{ ...SCENE_MASK, objectPosition: look.focus }}
                className="brand-art-fade pointer-events-none block h-[150px] w-full select-none rounded-2xl object-cover sm:h-[240px] lg:h-auto lg:max-h-[58dvh] lg:rounded-none lg:object-contain lg:object-left-bottom"
              />
            </div>
          </section>

          {/* Right: Login Card */}
          <section className="w-full max-w-[450px] justify-self-center rounded-3xl border border-line/75 bg-surface p-4 shadow-[0_16px_40px_-16px_rgb(0_0_0/0.08),0_2px_8px_-2px_rgb(0_0_0/0.04)] sm:p-8 lg:p-9 lg:justify-self-end">
            <h2 className="text-xl font-bold tracking-normal text-ink sm:text-2xl lg:text-3xl leading-snug sm:leading-tight">
              {!bootstrap ? t('เข้าสู่ระบบ') : firstAdmin ? t('ตั้งค่าผู้ดูแลระบบคนแรก') : t('ขอสิทธิ์เข้าใช้งาน')}
            </h2>
            <p className="mt-1 text-xs leading-normal text-ink-soft sm:text-sm">
              {t('ยินดีต้อนรับกลับสู่ {name} Stock', { name: look.short })}
            </p>

            <form onSubmit={submit} className="mt-4 space-y-3 sm:mt-6 sm:space-y-4">
            {bootstrap && (
              <div>
                <label htmlFor="login-name" className="mb-1 block text-xs font-semibold leading-normal text-ink-soft sm:mb-1.5">
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
                    className="h-11 w-full rounded-xl border border-line bg-surface pl-10 pr-3 text-sm text-ink outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand/20 placeholder:text-ink-faint sm:h-12"
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="login-email" className="mb-1 block text-xs font-semibold leading-normal text-ink-soft sm:mb-1.5">
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
                  className="h-11 w-full rounded-xl border border-line bg-surface pl-10 pr-3 text-sm text-ink outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand/20 placeholder:text-ink-faint sm:h-12"
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between sm:mb-1.5">
                <label htmlFor="login-password" className="text-xs font-semibold leading-normal text-ink-soft">
                  {t('รหัสผ่าน')}
                </label>
                {!bootstrap && (
                  <button
                    type="button"
                    onClick={() => void forgot()}
                    disabled={busy}
                    className="cursor-pointer text-xs font-medium leading-normal text-brand hover:underline"
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
                  className="h-11 w-full rounded-xl border border-line bg-surface pl-10 pr-11 text-sm text-ink outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand/20 placeholder:text-ink-faint sm:h-12"
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

            {bootstrap && <p className="text-xs leading-normal text-ink-faint">{t('อย่างน้อย 6 ตัวอักษร')}</p>}

            {bootstrap && !firstAdmin && (
              <p className="rounded-lg bg-sunken px-3 py-2 text-xs leading-relaxed text-ink-soft">
                {t('บัญชีใหม่จะยังเข้าใช้ข้อมูลไม่ได้จนกว่าผู้ดูแลระบบจะอนุมัติ')}
              </p>
            )}

            {notice && !error && (
              <div role="status" className="rounded-lg bg-warn-soft px-3 py-2 text-xs leading-normal text-warn">
                {t(notice)}
              </div>
            )}
            {info && !error && (
              <div role="status" className="rounded-lg bg-in-soft px-3 py-2 text-xs leading-normal text-in">
                {info}
              </div>
            )}
            {error && (
              <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium leading-normal text-danger">
                {t(error)}
              </div>
            )}

            <Button
              type="submit"
              disabled={busy}
              className={`!h-11 w-full !rounded-xl !text-sm ${legacyFont ? '!font-bold' : '!font-semibold'} leading-normal shadow-xs hover:shadow-sm active:scale-[0.99] transition-all sm:!h-12`}
            >
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

          {/* Only the local mode says where its data lives (owner, 9 Oct 2026: the cloud line is gone). */}
          {mode !== 'cloud' && <p className="mt-4 text-center text-[11px] text-ink-faint">{t('โหมดในเครื่อง — ข้อมูลเก็บในเบราว์เซอร์นี้')}</p>}

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
        </div>
      </main>

      {/* ---- Footer: Clean framing at bottom of full-height layout ---- */}
      <footer className="mx-auto flex w-full max-w-[1400px] shrink-0 items-center justify-between px-5 py-3 text-[11px] text-ink-faint sm:px-8 sm:pr-64 lg:px-12 lg:pr-64">
        <div>© 2026 Inventory OS</div>
        <div className="flex items-center gap-2">
          <span>{look.short}</span>
          <span aria-hidden="true">•</span>
          <span>{mode === 'cloud' ? 'Cloud' : 'Local / Demo'}</span>
        </div>
      </footer>
    </div>
  )
}

/**
 * Circular brand logo switcher with polished interactive micro-transitions.
 * Circular buttons (44-48px) showing original brand logos (Pizza Mania, Le Lapin, R&D).
 * Interactive lift and active ring; zero continuous loops. Respects prefers-reduced-motion.
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
      className="flex items-center gap-2 sm:gap-2.5"
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
            title={b.name}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(b.id)}
            style={{
              boxShadow: active
                ? `0 0 0 2.5px #fff, 0 0 0 5px ${b.accentVivid}, 0 8px 18px -4px ${b.accentVivid}66`
                : undefined,
              // the float drifts: each icon a beat after the last
              animationDelay: active ? undefined : `${i * 0.4}s`,
            }}
            className={`brand-orb group relative flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-white p-0.5 outline-none transition-[opacity,filter,box-shadow] duration-300 motion-reduce:transition-none sm:h-12 sm:w-12 lg:h-14 lg:w-14 ${
              active ? 'shadow-md' : 'opacity-70 saturate-[0.6] shadow-xs hover:opacity-100 hover:saturate-100 hover:shadow-md'
            } focus-visible:ring-3 focus-visible:ring-offset-2 focus-visible:ring-brand`}
          >
            <img
              src={b.logo}
              alt=""
              draggable={false}
              className="pointer-events-none h-full w-full select-none rounded-full object-cover"
            />
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
