import type { CSSProperties } from 'react'
import type { BrandId } from '../../brand/brand'

/**
 * The still scene behind each mascot, as the owner's mock-ups draw it (5 Oct 2026): Pizza
 * Mania's pink blob with its line drawings of the kitchen — a slice, a tomato, a mushroom,
 * leaves, a few dots — and Le Lapin's peach bakery: bread on shelves, a potted plant, jars
 * and boxes. Never animated; the mascot walks in front of it. Drawn in the brand's palest
 * tones so it stays behind the figure and the form.
 *
 * The viewBox is 600 × 600 with the ground line at y = 560, the same line the mascot stands
 * on in the layout.
 */
export function LoginScenery({ brand, className = '', style }: { brand: BrandId; className?: string; style?: CSSProperties }) {
  return brand === 'pizza' ? <PizzaScene className={className} style={style} /> : <BakeryScene className={className} style={style} />
}

type SceneProps = { className: string; style?: CSSProperties }

function PizzaScene({ className, style }: SceneProps) {
  const line = { fill: 'none', stroke: '#f3b8b8', strokeWidth: 4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg viewBox="0 0 600 600" aria-hidden="true" focusable="false" className={className} style={style} preserveAspectRatio="xMidYMax meet">
      {/* the blob */}
      <path
        d="M150 132 C 236 52, 420 50, 500 126 C 578 200, 566 318, 534 404 C 498 500, 352 556, 214 532 C 98 512, 44 420, 58 322 C 68 246, 92 186, 150 132 Z"
        fill="#fdeaea"
      />
      {/* ground shadow */}
      <ellipse cx="312" cy="560" rx="214" ry="17" fill="#f9d3d3" />
      {/* a slice, upper right */}
      <g {...line} transform="translate(452 112) rotate(14)">
        <path d="M0 0 C 30 -10, 70 -8, 96 6 L 44 92 Z" />
        <path d="M2 -2 C 32 -14, 72 -12, 98 4" strokeWidth={9} stroke="#f6c7c7" />
        <circle cx="40" cy="22" r="8" />
        <circle cx="62" cy="34" r="6" />
        <circle cx="44" cy="52" r="5" />
      </g>
      {/* a tomato, left */}
      <g {...line} transform="translate(92 380)">
        <circle cx="0" cy="0" r="36" />
        <path d="M-14 -34 L 0 -24 L 14 -34 M 0 -24 L 0 -44" />
        <path d="M-18 -8 C -12 -18, -2 -20, 6 -18" stroke="#f7caca" />
      </g>
      {/* a mushroom, bottom left */}
      <g {...line} transform="translate(166 470)">
        <path d="M-40 6 C -38 -34, 38 -34, 40 6 Z" />
        <path d="M-14 6 L -12 44 C -6 50, 6 50, 12 44 L 14 6" />
        <circle cx="-14" cy="-12" r="4" />
        <circle cx="12" cy="-16" r="5" />
      </g>
      {/* leaves, bottom right */}
      <g {...line} transform="translate(520 440) rotate(-20)">
        <path d="M0 0 C 26 -34, 62 -30, 70 0 C 58 26, 22 30, 0 0 Z" />
        <path d="M2 0 L 64 -2" />
        <path d="M-6 30 C 18 6, 46 14, 52 38 C 36 54, 6 52, -6 30 Z" />
      </g>
      {/* dots and dashes */}
      <g fill="#f6c5c5">
        <circle cx="120" cy="236" r="6" />
        <circle cx="210" cy="96" r="5" />
        <circle cx="560" cy="276" r="5" />
        <circle cx="70" cy="474" r="7" />
        <circle cx="474" cy="520" r="5" />
      </g>
    </svg>
  )
}

function BakeryScene({ className, style }: SceneProps) {
  const shelf = '#f7d9c2'
  const loaf = '#f4c8a6'
  const leaf = '#f6caa6'
  return (
    <svg viewBox="0 0 600 600" aria-hidden="true" focusable="false" className={className} style={style} preserveAspectRatio="xMidYMax meet">
      {/* the blob, rising behind the figure */}
      <path
        d="M196 96 C 300 40, 452 70, 512 170 C 566 262, 560 392, 520 470 C 486 540, 360 566, 250 548 C 150 530, 98 446, 108 344 C 118 238, 124 140, 196 96 Z"
        fill="#fdece0"
      />
      {/* ground shadow */}
      <ellipse cx="300" cy="561" rx="236" ry="16" fill="#f8dcc8" />
      {/* shelves of bread, left */}
      <g transform="translate(18 300)">
        <rect x="0" y="0" width="190" height="250" rx="8" fill="#fbe6d6" />
        <rect x="0" y="80" width="190" height="10" fill={shelf} />
        <rect x="0" y="166" width="190" height="10" fill={shelf} />
        <g fill={loaf}>
          <rect x="18" y="44" width="70" height="34" rx="17" />
          <rect x="96" y="40" width="76" height="38" rx="19" />
          <rect x="22" y="128" width="64" height="36" rx="10" />
          <rect x="94" y="132" width="40" height="32" rx="8" />
          <rect x="140" y="128" width="32" height="36" rx="8" />
          <rect x="24" y="212" width="58" height="36" rx="12" />
          <rect x="92" y="216" width="80" height="32" rx="16" />
        </g>
      </g>
      {/* a potted plant, front left */}
      <g transform="translate(70 452)">
        <path d="M-6 -60 C -48 -110, -60 -170, -40 -196 C -14 -160, -6 -110, -6 -60 Z" fill={leaf} />
        <path d="M6 -60 C 34 -120, 74 -150, 98 -150 C 86 -110, 46 -78, 6 -60 Z" fill={leaf} />
        <path d="M0 -58 C -24 -100, -96 -100, -110 -84 C -84 -66, -36 -58, 0 -58 Z" fill="#f8d4b6" />
        <path d="M-40 -58 L 40 -58 L 30 46 C 10 54, -10 54, -30 46 Z" fill="#f4c9a8" />
      </g>
      {/* jars on the right */}
      <g fill="#f6d2b6">
        <rect x="452" y="414" width="34" height="60" rx="8" />
        <rect x="456" y="404" width="26" height="12" rx="3" fill="#f2c4a2" />
      </g>
      {/* boxes, right */}
      <g>
        <rect x="486" y="430" width="94" height="128" rx="6" fill="#f8dac4" />
        <rect x="502" y="368" width="70" height="64" rx="5" fill="#f6d0b4" />
        <rect x="486" y="486" width="94" height="6" fill="#f4c9a8" />
      </g>
    </svg>
  )
}
