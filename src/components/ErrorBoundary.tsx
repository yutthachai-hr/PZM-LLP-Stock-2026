import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useT } from '../i18n/I18nContext'
import { Icon } from './Icon'
import { Button } from './ui'

/**
 * One page that throws while drawing shows a message and a way out, instead of a blank
 * screen with the menu gone (plan C1). Keyed on the path by the layout, so moving to
 * another page starts clean.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[page] failed to draw', error, info.componentStack)
  }

  render() {
    if (this.state.error) return <PageFailed message={this.state.error.message} onRetry={() => this.setState({ error: null })} />
    return this.props.children
  }
}

function PageFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT()
  return (
    <div role="alert" className="mx-auto max-w-lg rounded-2xl border border-danger/40 bg-danger-soft p-6 text-center">
      <Icon name="alertCircle" size={28} className="mx-auto text-danger" />
      <h2 className="mt-2 text-base font-semibold text-ink">{t('หน้านี้แสดงผลไม่สำเร็จ')}</h2>
      <p className="mt-1 text-sm text-ink-soft">{t('ข้อมูลที่บันทึกไว้ไม่ได้รับผลกระทบ ลองโหลดหน้านี้ใหม่ หรือไปหน้าอื่นก่อน')}</p>
      <p className="mt-2 break-words font-mono text-xs text-ink-faint">{message}</p>
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="secondary" onClick={onRetry}>
          {t('ลองใหม่')}
        </Button>
        <Button onClick={() => window.location.reload()}>{t('โหลดหน้าใหม่')}</Button>
      </div>
    </div>
  )
}
