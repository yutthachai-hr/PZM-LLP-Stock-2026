import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './notices.css'

const Slot = createContext<{ target: HTMLDivElement | null; reserve: (count: number) => void } | null>(null)

/** One visual lane prevents the two independent notification queues occupying the same corner. */
export function NoticeViewport({ children, renderToasts }: { children: ReactNode; renderToasts: (capacityUsed: number) => ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const [reserved, reserve] = useState(0)
  const [keyboard, setKeyboard] = useState(0)
  const context = useMemo(() => ({ target, reserve }), [target])
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => setKeyboard(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop))
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update) }
  }, [])
  return <Slot.Provider value={context}>
    {children}
    <div className="notice-viewport" style={{ '--notice-keyboard': `${keyboard}px` } as CSSProperties}>
      <div ref={setTarget} className="flex flex-col gap-2" />
      {renderToasts(reserved)}
    </div>
  </Slot.Provider>
}

export function OperationalNotices({ count, children }: { count: number; children: ReactNode }) {
  const slot = useContext(Slot)
  const reserve = slot?.reserve
  useLayoutEffect(() => {
    reserve?.(count)
    return () => reserve?.(0)
  }, [count, reserve])
  return slot?.target ? createPortal(children, slot.target) : null
}
