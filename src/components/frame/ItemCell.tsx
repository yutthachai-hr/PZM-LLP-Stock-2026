import type { ReactNode } from 'react'
import { Icon, type IconName } from '../Icon'
import { ProductThumb } from '../ProductThumb'
import { toneIcon, type Tone } from './tones'

/**
 * The first column of the mock-ups' tables: a 40px picture, the name, and a grey line
 * under it (SKU, category · unit, a phone number).
 *
 * Products without an uploaded photo — most of them; Firebase's free tier has no Storage —
 * get an icon in a tinted square instead of an empty grey box (spec §2.2).
 */
export function ItemCell({
  title,
  sub,
  productId,
  hasImage,
  icon = 'box',
  tone = 'slate',
  avatar,
}: {
  title: ReactNode
  sub?: ReactNode
  /** Show the product's photo when it has one. */
  productId?: string
  hasImage?: boolean
  /** Shown when there is no photo. */
  icon?: IconName
  tone?: Tone
  /** Letters in a circle instead of a picture — a supplier, a person. */
  avatar?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {avatar !== undefined ? (
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${toneIcon[tone]}`}>
          {avatar.slice(0, 2).toUpperCase() || '?'}
        </span>
      ) : productId && hasImage ? (
        <ProductThumb productId={productId} hasImage size={40} />
      ) : (
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneIcon[tone]}`}>
          <Icon name={icon} size={19} />
        </span>
      )}
      <div className="min-w-0">
        {/* Two lines on a phone card, where the name is the heading; one line in a table row. */}
        <div className="line-clamp-2 font-semibold leading-snug text-ink md:truncate">{title}</div>
        {sub && <div className="truncate text-xs text-ink-faint">{sub}</div>}
      </div>
    </div>
  )
}
