import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider, useToast } from '../src/components/Toast'
import { OperationalNotices } from '../src/components/notifications/NoticeViewport'
import { I18nProvider, useI18n, useT } from '../src/i18n/I18nContext'
import '../src/index.css'

function Controls() {
  const toast = useToast()
  const t = useT()
  const { lang, setLang } = useI18n()
  const first = useRef(toast)
  const [actions, setActions] = useState(0)
  const [operational, setOperational] = useState(0)
  const [identityChanges, setIdentityChanges] = useState(0)
  useEffect(() => { if (toast !== first.current) setIdentityChanges((n) => n + 1) }, [toast])
  return <>
    <header className="fixed inset-x-0 top-0 h-16 border-b border-line bg-surface px-5 py-4 font-semibold text-ink">PZM · Toast QA · synthetic data</header>
    <main className="mx-auto max-w-4xl space-y-4 px-5 pb-64 pt-24">
      <h1 className="text-xl font-semibold text-ink">Transient notification QA</h1>
      <p className="text-sm text-ink-soft">Real toast components. These buttons do not write stock, orders or prices.</p>
      <div className="flex flex-wrap gap-3 [&>button]:min-h-11 [&>button]:rounded-lg [&>button]:border [&>button]:border-line-strong [&>button]:bg-surface [&>button]:px-4">
        <button onClick={() => toast.success(`${t('บันทึกราคาแล้ว')} — ${t('฿{cost} ต่อ {unit}', { cost: '350.2203', unit: 'KG' })}`)}>Legacy price</button>
        <button onClick={() => toast.success({ title: t('บันทึกราคาแล้ว'), description: t('฿{cost} ต่อ {unit}', { cost: '350.2203', unit: 'KG' }) })}>Save price</button>
        <button onClick={() => toast.success(t('สั่งของแล้ว'))}>Save order</button>
        <button onClick={() => toast.error({ title: t('เกิดข้อผิดพลาด'), description: 'The request could not be saved. Check the connection and try again.' })}>Error</button>
        <button onClick={() => toast.warning({ title: t('เตือน'), description: 'Please check the supplier and quantity before continuing.' })}>Warning</button>
        <button onClick={() => toast.info({ title: t('ข้อมูล'), description: 'This notice has additional details that wrap naturally on a small screen.' })}>Info</button>
        <button onClick={() => { for (let n = 0; n < 8; n++) toast.success(t('สั่งของแล้ว')) }}>Duplicates</button>
        <button onClick={() => { for (let n = 1; n <= 6; n++) toast.info(`Notice ${n}`) }}>Six notices</button>
        <button onClick={() => toast.info({ title: 'Action available', action: { label: 'Undo demo action', onClick: () => setActions((n) => n + 1) } })}>Action notice</button>
        <button onClick={() => setLang(lang === 'th' ? 'en' : 'th')}>TH/EN</button>
        <button onClick={() => setOperational(3)}>Operational alerts</button>
        <button onClick={() => setOperational(0)}>Clear operational alerts</button>
      </div>
      <label className="block text-ink">Keyboard target<input aria-label="Keyboard target" className="mt-1 block rounded-lg border border-line-strong bg-surface p-3" /></label>
      <output data-testid="identity-changes">{identityChanges}</output>
      <output data-testid="action-count">{actions}</output>
    </main>
    <OperationalNotices count={operational}>{Array.from({ length: operational }, (_, i) => <div key={i} role="alert" className="notice-card border border-line p-4 text-ink">Operational alert {i + 1}</div>)}</OperationalNotices>
    <footer data-testid="bottom-controls" className="fixed inset-x-0 bottom-[var(--tabbar-h)] h-16 border-y border-line bg-surface p-3 md:hidden"><button className="h-10 rounded-lg bg-brand px-5 text-white">Critical receive control</button></footer>
    <nav data-testid="tabbar" className="fixed inset-x-0 bottom-0 flex h-[var(--tabbar-h)] justify-around border-t border-line bg-surface py-5 md:hidden">Home · Stock · Receive · More</nav>
    <div data-testid="demo-pill" className="pointer-events-none fixed bottom-4 right-4 rounded-full bg-danger px-3 py-1 text-xs text-white">Demo only</div>
  </>
}
function Harness() {
  const [mounted, setMounted] = useState(true)
  return <I18nProvider><button className="fixed left-2 top-16 z-10 bg-surface text-xs" onClick={() => setMounted((v) => !v)}>Toggle provider</button>{mounted && <ToastProvider><Controls /></ToastProvider>}</I18nProvider>
}
createRoot(document.getElementById('root')!).render(<Harness />)
