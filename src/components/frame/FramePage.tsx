import type { ReactNode } from 'react'

/**
 * The root of a page drawn in the new frame.
 *
 * Until a page is converted it sits on the one white sheet Layout draws on a desktop
 * (21 Sep mock-up). The 22 Sep mock-ups put every block in its own white card on the grey
 * canvas instead, and a card inside a white sheet is a white box on white. A page wrapped
 * in FramePage tells Layout — through `data-frame`, read by a `:has()` selector there — to
 * leave the sheet out, so converted and unconverted pages can ship side by side while the
 * restyle goes round by round.
 */
export function FramePage({ children }: { children: ReactNode }) {
  return (
    <div data-frame="" className="space-y-4 xl:space-y-5">
      {children}
    </div>
  )
}
