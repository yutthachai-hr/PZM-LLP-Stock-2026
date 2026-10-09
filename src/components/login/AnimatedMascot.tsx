import { useEffect, useRef, useState } from 'react'
import type { BrandId } from '../../brand/brand'

/**
 * The login page's mascot walking in place (owner, 5 Oct 2026), played from a rig.
 *
 * One master drawing per brand, cut into parts: the upper body is a single piece of the
 * original art — face, hat, the four boxes and their lettering, the bread — so it never
 * changes; the legs are solved per pose (heel strike, flat foot, push-off, swing) and the
 * chef's forearm swings from inside its cuff. The poses are computed offline from the same
 * rig that renders the 60 fps WebP and GIF previews (loginanim/rig in the handoff), and
 * shipped as one sampled cycle per brand in public/login/rig/<brand>/rig.json.
 *
 * Here the cycle is played by time with requestAnimationFrame, interpolating between the
 * samples, so it moves at whatever the display refreshes at. Each frame writes transform
 * attributes on the SVG's own elements: React renders once and never again per frame. It
 * stops while the tab is hidden (the browser pauses rAF), while it is off screen, and for
 * anyone who asks for reduced motion — then it stands in its first pose.
 *
 * The rabbit's legs are drawn, not cut: one curve hip → ankle through the knee, in the
 * drawing's outline, shade and fill. Add ?rigdebug to the address to see every hip, knee and
 * ankle, the near leg in blue and the far leg in pink, and the ground line.
 */

interface RigPart {
  src: string
  w: number
  h: number
  pivot: [number, number]
  origin?: [number, number]
}
interface Rig {
  viewBox: [number, number]
  ground: number
  seconds: number
  order: string[]
  legStyle: 'image' | 'stroke'
  legCurve?: 'quadratic' | null
  stroke?: {
    outline: number[]
    outline_w: number
    fill: number[]
    fill_w: number
    shade: number[]
    shade_w: number
    shade_dx: number
    fill_dx: number
    farDim: number
  }
  parts: Record<string, RigPart>
  /** Per sample: part → [x, y, angle (deg, counter-clockwise)], leg → [hx, hy, kx, ky, ax, ay], shadow → [cx, half-width]. */
  samples: Record<string, number[]>[]
}

/** Brands with a rig. R&D has none (it came later): the login page shows its logo instead. */
const SLUG: Partial<Record<BrandId, string>> = { pizza: 'pizza-mania', lelapin: 'le-lapin' }
const cache = new Map<string, Promise<Rig>>()
function loadRig(slug: string): Promise<Rig> {
  let p = cache.get(slug)
  if (!p) {
    p = fetch(`/login/rig/${slug}/rig.json`).then((r) => {
      if (!r.ok) throw new Error(`rig ${slug}: ${r.status}`)
      return r.json() as Promise<Rig>
    })
    cache.set(slug, p)
  }
  return p
}

/** The leg as one curve through the knee: M hip Q c ankle with c = 2·knee − (hip + ankle)/2. */
function legPath(v: number[]): string {
  const [hx, hy, kx, ky, ax, ay] = v
  return `M${hx} ${hy}Q${2 * kx - (hx + ax) / 2} ${2 * ky - (hy + ay) / 2} ${ax} ${ay}`
}

const DEBUG_SIDES = [
  ['near', '#28aaff'],
  ['far', '#ff3caa'],
] as const

const rgb = (c: number[], f = 1) => `rgb(${Math.round(c[0] * f)} ${Math.round(c[1] * f)} ${Math.round(c[2] * f)})`

export function AnimatedMascot({ brand, className = '' }: { brand: BrandId; className?: string }) {
  const slug = SLUG[brand]
  // the rig is kept with the brand it was loaded for: on a brand switch the old rig must not
  // be drawn with the new brand's file paths, even for the one render before it is replaced
  const [loaded, setLoaded] = useState<{ slug: string; rig: Rig } | null>(null)
  const rig = slug && loaded && loaded.slug === slug ? loaded.rig : null
  const svgRef = useRef<SVGSVGElement>(null)
  const [debug] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('rigdebug'))

  useEffect(() => {
    if (!slug) return // no rig for this brand: nothing is fetched
    let live = true
    loadRig(slug)
      .then((r) => live && setLoaded({ slug, rig: r }))
      .catch(() => live && setLoaded(null))
    return () => {
      live = false
    }
  }, [slug])

  useEffect(() => {
    const svg = svgRef.current
    if (!rig || !svg) return
    const nodes = new Map<string, Element[]>()
    for (const key of rig.order) nodes.set(key, Array.from(svg.querySelectorAll(`[data-part="${key}"]`)))
    const shadow = svg.querySelector('[data-shadow]')
    const N = rig.samples.length
    // the joint overlay needs the legs' samples; a rig exported without them just plays
    const showJoints = debug && 'near_leg' in rig.samples[0] && 'far_leg' in rig.samples[0]

    function apply(phase: number) {
      const f = phase * N
      const i = Math.floor(f) % N
      const j = (i + 1) % N
      const k = f - Math.floor(f)
      const A = rig!.samples[i]
      const B = rig!.samples[j]
      const at = (key: string, n: number) => A[key][n] + (B[key][n] - A[key][n]) * k
      const leg = (key: string) => [0, 1, 2, 3, 4, 5].map((n) => at(key, n))
      for (const key of rig!.order) {
        const els = nodes.get(key) ?? []
        if (key.endsWith('_leg')) {
          const d = legPath(leg(key))
          for (const el of els) el.setAttribute('d', d)
          continue
        }
        const part = rig!.parts[key]
        const x = at(key, 0)
        const y = at(key, 1)
        const a = at(key, 2)
        const t = part.origin
          ? `translate(${x + part.origin[0]} ${y + part.origin[1]})`
          : `translate(${x} ${y}) rotate(${-a}) translate(${-part.pivot[0]} ${-part.pivot[1]})`
        for (const el of els) el.setAttribute('transform', t)
      }
      if (shadow) {
        shadow.setAttribute('cx', String(at('shadow', 0)))
        shadow.setAttribute('rx', String(at('shadow', 1)))
      }
      for (const [side] of showJoints ? DEBUG_SIDES : []) {
        const v = leg(`${side}_leg`)
        svg!.querySelector(`[data-debug="${side}"]`)?.setAttribute('points', `${v[0]},${v[1]} ${v[2]},${v[3]} ${v[4]},${v[5]}`)
        svg!.querySelectorAll(`[data-debug-joint="${side}"]`).forEach((c, n) => {
          c.setAttribute('cx', String(v[n * 2]))
          c.setAttribute('cy', String(v[n * 2 + 1]))
        })
      }
    }

    apply(0)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let raf = 0
    let start = 0
    let visible = true
    const tick = (now: number) => {
      if (!start) start = now
      apply((((now - start) / 1000) % rig.seconds) / rig.seconds)
      raf = requestAnimationFrame(tick)
    }
    const run = () => {
      cancelAnimationFrame(raf)
      raf = 0
      if (!reduce.matches && visible) raf = requestAnimationFrame(tick)
      else apply(0)
    }
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      run()
    })
    io.observe(svg)
    reduce.addEventListener('change', run)
    run()
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      reduce.removeEventListener('change', run)
    }
  }, [rig, debug])

  if (!rig) {
    // Holds the space while the rig loads, so nothing shifts when it arrives.
    return <div aria-hidden="true" className={className} style={{ aspectRatio: brand === 'pizza' ? '990 / 1413' : '930 / 1191' }} />
  }
  const [W, H] = rig.viewBox
  const st = rig.stroke
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false" className={className} style={{ aspectRatio: `${W} / ${H}` }}>
      <defs>
        <filter id={`mascot-shadow-${slug}`} x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <ellipse data-shadow cy={rig.ground + 2} ry={20} fill="rgb(60 20 20 / 0.27)" filter={`url(#mascot-shadow-${slug})`} />
      {rig.order.map((key) => {
        if (key.endsWith('_leg')) {
          if (!st) return null
          const dimF = key.startsWith('far_') ? st.farDim : 1
          const line = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const
          return (
            <g key={key}>
              <path data-part={key} {...line} stroke={rgb(st.outline, dimF)} strokeWidth={st.outline_w} />
              <path data-part={key} {...line} stroke={rgb(st.shade, dimF)} strokeWidth={st.fill_w} transform={`translate(${st.shade_dx} 0)`} />
              <path data-part={key} {...line} stroke={rgb(st.fill, dimF)} strokeWidth={st.fill_w - st.shade_w} transform={`translate(${st.fill_dx} 0)`} />
            </g>
          )
        }
        const p = rig.parts[key]
        return <image key={key} data-part={key} href={`/login/rig/${slug}/${p.src}`} width={p.w} height={p.h} />
      })}
      {debug && (
        <g>
          <line x1={0} x2={W} y1={rig.ground} y2={rig.ground} stroke="#00a0ff" strokeWidth={3} />
          {DEBUG_SIDES.map(([side, color]) => (
            <g key={side}>
              <polyline data-debug={side} fill="none" stroke={color} strokeWidth={6} />
              {[0, 1, 2].map((n) => (
                <circle key={n} data-debug-joint={side} r={12} fill="#fff" stroke={color} strokeWidth={5} />
              ))}
            </g>
          ))}
        </g>
      )}
    </svg>
  )
}
