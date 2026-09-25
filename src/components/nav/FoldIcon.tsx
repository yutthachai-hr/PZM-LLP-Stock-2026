import type { BrandId } from '../../brand/brand'
import { Icon } from '../Icon'

/**
 * What a menu section's bar shows in place of a chevron (owner, 26 Sep 2026): a slice of
 * pepperoni pizza for Pizza Mania, a baguette for Le Lapin — in their own colours, which is
 * why they are drawn here and not in Icon's one-colour set. Folded, the picture turns a
 * quarter to the right, the way a chevron would.
 */
export function FoldIcon({ brand, open }: { brand: BrandId | null; open: boolean }) {
  const turn = `shrink-0 transition-transform duration-200 ${open ? '' : '-rotate-90'}`
  if (!brand) return <Icon name="chevronDown" size={16} className={`${turn} text-ink-faint`} />
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true" className={turn}>
      {brand === 'pizza' ? <PizzaSlice /> : <Baguette />}
    </svg>
  )
}

const PEPPERONI = '#D64530'

function PizzaSlice() {
  return (
    <>
      <path d="M4 6.6Q12 2.6 20 6.6L12.9 20.6a1 1 0 0 1-1.8 0Z" fill="#F5C242" stroke="#B8702A" strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M3.4 6.3Q12 1.8 20.6 6.3" fill="none" stroke="#C97A2E" strokeWidth={3} strokeLinecap="round" />
      <circle cx={10} cy={10.6} r={1.7} fill={PEPPERONI} />
      <circle cx={14.3} cy={11.8} r={1.4} fill={PEPPERONI} />
      <circle cx={11.9} cy={15.6} r={1.2} fill={PEPPERONI} />
    </>
  )
}

function Baguette() {
  return (
    <>
      <path
        d="M5.6 18.4a2.8 2.8 0 0 1 0-4l8.8-8.8a2.8 2.8 0 0 1 4 4l-8.8 8.8a2.8 2.8 0 0 1-4 0Z"
        fill="#DDA15E"
        stroke="#9A5A1E"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <path d="M7.6 14.6l1.6 1.6M11.2 11l1.6 1.6M14.8 7.4l1.6 1.6" fill="none" stroke="#F6D9A6" strokeWidth={1.6} strokeLinecap="round" />
    </>
  )
}
