import { lazy, Suspense, useEffect, type ComponentProps } from 'react'
import { useT } from '../../i18n/I18nContext'
import { Modal } from '../ui'
import type { LineImportWindow } from './LineImportWindow'

export type { ImportedLine } from './LineImportWindow'

// The import window is loaded when someone opens it (15 Oct 2026). Every keying screen offers
// it, few visits use it, and the file and text readers behind it would otherwise ride in the
// first load of every page.
const LazyWindow = lazy(() => import('./LineImportWindow').then((m) => ({ default: m.LineImportWindow })))

export function LineImportModal(props: ComponentProps<typeof LineImportWindow>) {
  const t = useT()
  // A file dropped beside the drop zone must not make the browser leave the app to open it,
  // including while the window is still loading.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])
  const loading = (
    <Modal open wide onClose={props.onClose} title={props.title ?? t('นำเข้ารายการสินค้า')}>
      <p className="py-10 text-center text-sm text-ink-soft">{t('กำลังโหลด...')}</p>
    </Modal>
  )
  return (
    <Suspense fallback={loading}>
      <LazyWindow {...props} />
    </Suspense>
  )
}
