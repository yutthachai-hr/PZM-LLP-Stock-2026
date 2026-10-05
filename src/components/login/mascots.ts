import type { BrandId } from '../../brand/brand'

/**
 * The login page's walking mascots (owner, 5 Oct 2026): the brand's character walking in
 * place beside the sign-in form.
 *
 * Each is one horizontal sprite of the owner's own walk frames (ten per cycle), aligned
 * frame to frame before packing so the figure does not jitter: the chef with his planted
 * foot held to the ground line (60%) and his upper body steady (40%) — the drawings give the
 * passing poses shorter legs, so pinning either fully bounces the other; the rabbit, whose
 * frames are a run with both feet off the ground in places, by its head, body and bread.
 *
 * The shadow is measured from the same frames: how wide the stance is and how high the feet
 * are off the ground, one value per frame.
 */
export interface MascotDef {
  sprite: string
  frames: number
  /** One frame's size in the sprite, for the aspect ratio. */
  frameW: number
  frameH: number
  /** One full walk cycle. */
  seconds: number
  /** Where under the figure the feet are, as a share of the frame's width. */
  shadowX: number
  /** Per frame: the shadow's width scale and its strength. */
  shadowScale: readonly number[]
  shadowOpacity: readonly number[]
}

export const MASCOTS: Record<BrandId, MascotDef> = {
  pizza: {
    sprite: '/login/pizza-mania-walk.webp',
    frames: 10,
    frameW: 517,
    frameH: 720,
    seconds: 1.05,
    shadowX: 0.54,
    shadowScale: [0.89, 0.89, 0.91, 0.94, 0.98, 0.98, 1, 0.92, 0.94, 0.98],
    shadowOpacity: [0.99, 0.99, 0.96, 0.94, 0.9, 1, 0.94, 0.97, 0.97, 0.89],
  },
  lelapin: {
    sprite: '/login/le-lapin-walk.webp',
    frames: 10,
    frameW: 636,
    frameH: 720,
    // A run, so a touch quicker than the chef's walk.
    seconds: 0.9,
    shadowX: 0.45,
    shadowScale: [0.88, 1, 0.85, 0.77, 0.79, 0.91, 0.73, 0.67, 0.78, 0.95],
    shadowOpacity: [0.82, 1, 0.76, 0.64, 0.68, 0.86, 0.58, 0.49, 0.66, 0.92],
  },
}

/** The shadow's keyframes, one stop per frame and back to the first so the loop is seamless. */
export function shadowKeyframes(name: string, m: MascotDef): string {
  const stops = m.shadowScale.map((s, i) => `${((i / m.frames) * 100).toFixed(2)}%{transform:translateX(-50%) scaleX(${s});opacity:${m.shadowOpacity[i]}}`)
  stops.push(`100%{transform:translateX(-50%) scaleX(${m.shadowScale[0]});opacity:${m.shadowOpacity[0]}}`)
  return `@keyframes ${name}{${stops.join('')}}`
}
