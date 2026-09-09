import { BRANDS, lastBrand, type BrandId } from '../brand/brand'
import { useAuth } from '../auth/AuthContext'
import { useT } from '../i18n/I18nContext'
import { LangToggle } from '../i18n/LangToggle'

export function BrandPicker({ onPick }: { onPick: (b: BrandId) => void }) {
  const { user, logout } = useAuth()
  const t = useT()
  const last = lastBrand()

  // Sign-in and brand choice happen before a brand is picked, so there is no brand
  // accent to use yet. The gradient is deliberately both brands at once — Pizza Mania
  // red into Le Lapin orange — rather than a token.
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
        <LangToggle className="mx-auto mb-4 w-32" />
        <h1 className="text-center text-xl font-bold text-ink">{t('เลือกแบรนด์ที่จะจัดการ')}</h1>
        <p className="mb-5 mt-1 text-center text-sm text-ink-soft">
          {t('สวัสดี {name} — ข้อมูลสต๊อกของแต่ละแบรนด์แยกกันสมบูรณ์', { name: user?.name ?? '' })}
        </p>
        <div className="space-y-3">
          {BRANDS.map((b) => (
            <button
              key={b.id}
              onClick={() => onPick(b.id)}
              className={`flex w-full items-center gap-4 rounded-xl border-2 p-4 text-left transition-colors hover:border-brand/50 hover:bg-brand-soft ${
                b.id === last ? 'border-brand/40 bg-brand-soft/50' : 'border-line'
              }`}
            >
              <span className="text-4xl">{b.emoji}</span>
              <div className="min-w-0">
                <div className="font-semibold text-ink">{b.name}</div>
                <div className="text-xs text-ink-faint">
                  {b.id === 'pizza'
                    ? t('ระบบสต๊อกพิซซ่า')
                    : t('ระบบสต๊อกแซนด์วิช (แบรนด์น้อง)')}
                </div>
              </div>
              {b.id === last && (
                <span className="ml-auto text-xs font-medium text-brand">{t('ล่าสุด')}</span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={logout}
          className="mx-auto mt-5 block text-xs text-ink-faint hover:text-ink-soft hover:underline"
        >
          {t('ออกจากระบบ')}
        </button>
      </div>
    </div>
  )
}
