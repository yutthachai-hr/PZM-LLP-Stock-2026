import { useState } from 'react'
import { BRANDS, lastBrand, type BrandId } from '../brand/brand'
import { useAuth } from '../auth/AuthContext'
import { useT } from '../i18n/I18nContext'
import { LangToggle } from '../i18n/LangToggle'

/** The company artwork, one panel per brand (owner, 22 Sep 2026). Static files under public/. */
const ART: Record<BrandId, string> = {
  pizza: '/brand/pizza-mania.jpg',
  lelapin: '/brand/le-lapin.jpg',
}

/**
 * Which company's books to open. The two panels are the brands' own artwork, tapped
 * straight in — no words needed beyond the greeting. A tap presses the panel down and
 * lets it spring back before the screen changes, so the choice is felt as well as seen.
 */
export function BrandPicker({ onPick }: { onPick: (b: BrandId) => void }) {
  const { user, logout } = useAuth()
  const t = useT()
  const last = lastBrand()
  const [pressed, setPressed] = useState<BrandId | null>(null)

  function pick(id: BrandId) {
    setPressed(id)
    // Let the press be seen (the transition below is 150ms) before the screen changes.
    setTimeout(() => onPick(id), 180)
  }

  // Sign-in and brand choice happen before a brand is picked, so there is no brand
  // accent to use yet. The gradient is deliberately both brands at once — Pizza Mania
  // red into Le Lapin orange — rather than a token.
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 p-4">
      <div className="w-full max-w-md">
        <LangToggle className="mx-auto mb-5 w-32" />
        <h1 className="text-center text-2xl font-bold text-ink">{t('เลือกแบรนด์')}</h1>
        <p className="mb-6 mt-1 text-center text-base text-ink-soft">{t('สวัสดี {name}', { name: user?.name ?? '' })}</p>
        <div className="grid grid-cols-2 gap-4">
          {BRANDS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => pick(b.id)}
              aria-label={b.name}
              className={`group relative aspect-[500/580] w-full cursor-pointer overflow-hidden rounded-3xl shadow-lg outline-none transition-transform duration-150 ease-out hover:-translate-y-0.5 hover:shadow-xl focus-visible:ring-4 focus-visible:ring-brand/40 active:scale-95 ${
                pressed === b.id ? 'scale-95' : pressed ? 'scale-100 opacity-60' : ''
              } ${b.id === last ? 'ring-4 ring-white/80' : ''}`}
            >
              <img
                src={ART[b.id]}
                alt=""
                className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105 group-active:scale-110"
                draggable={false}
              />
              {b.id === last && (
                <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink shadow">
                  {t('ล่าสุด')}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => void logout()}
          className="mx-auto mt-8 block min-h-11 text-sm text-ink-faint hover:text-ink-soft hover:underline"
        >
          {t('ออกจากระบบ')}
        </button>
      </div>
    </div>
  )
}
