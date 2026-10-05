import type { CSSProperties } from 'react'
import type { BrandId } from '../../brand/brand'
import { MASCOTS, shadowKeyframes } from './mascots'

/**
 * A brand's mascot walking in place (see mascots.ts). Decorative: hidden from screen
 * readers, never focusable, and still under prefers-reduced-motion (index.css), where it
 * stands in its first frame.
 *
 * The walk is one CSS animation on the sprite's transform — steps() through the frames —
 * so React renders it once and the browser does the rest; nothing runs per frame in JS.
 */
export function AnimatedMascot({ brand, className = '' }: { brand: BrandId; className?: string }) {
  const m = MASCOTS[brand]
  const shadow = `mascot-shadow-${brand}`
  const vars = {
    aspectRatio: `${m.frameW} / ${m.frameH}`,
    '--mascot-frames': m.frames,
    '--mascot-seconds': `${m.seconds}s`,
  } as CSSProperties
  return (
    <div aria-hidden="true" className={`mascot ${className}`} style={vars}>
      <style>{shadowKeyframes(shadow, m)}</style>
      <span className="mascot-shadow" style={{ left: `${m.shadowX * 100}%`, animationName: shadow }} />
      <div className="mascot-window">
        <img
          src={m.sprite}
          alt=""
          draggable={false}
          decoding="async"
          className="mascot-strip"
          style={{ width: `${m.frames * 100}%` }}
        />
      </div>
    </div>
  )
}
