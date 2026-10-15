import { Component, useEffect, type ReactNode } from 'react'
import { Button, Spinner } from './ui'
import { useT } from '../i18n/I18nContext'

export const CHUNK_RELOAD_KEY = 'pzm_chunk_reload'

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false
  const msg = error instanceof Error ? error.message : String(error)
  const name = error instanceof Error ? error.name : ''
  return name === 'ChunkLoadError' || /chunk|dynamically imported module|module script/i.test(msg)
}

export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY)
  } catch {
    // sessionStorage may throw in privacy-restricted sandboxes
  }
}

export function ClearChunkReloadFlag(): null {
  useEffect(() => {
    clearChunkReloadFlag()
  }, [])
  return null
}

export function ErrorFallback({
  onReload,
  reloading,
}: {
  onReload: () => void
  reloading: boolean
}) {
  const t = useT()
  if (reloading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center">
        <Spinner label={t('กำลังโหลดเวอร์ชันใหม่...')} />
      </div>
    )
  }
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-4 rounded-xl border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-base font-semibold text-ink">
          {t('ไม่สามารถโหลดหน้านี้ได้')}
        </h2>
        <p className="text-sm text-ink-soft">
          {t('ระบบอาจมีการอัปเดตเวอร์ชันใหม่ หรือการเชื่อมต่ออินเทอร์เน็ตขัดข้อง กรุณากดโหลดใหม่')}
        </p>
        <div className="pt-2">
          <Button variant="primary" onClick={onReload}>
            {t('โหลดใหม่')}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  children: ReactNode
  resetKeys?: unknown[]
}

interface State {
  hasError: boolean
  error: Error | null
  reloading: boolean
}

// A deploy replaces the hashed page files, so a tab opened before it can ask for one that no
// longer exists. That case reloads once to pick up the new build (the sessionStorage flag stops
// a reload loop if the file is still missing); any other error shows the reload screen.
export class ErrorBoundary extends Component<Props, State> {
  static readonly CHUNK_RELOAD_KEY = CHUNK_RELOAD_KEY
  static readonly isChunkLoadError = isChunkLoadError
  static readonly clearReloadFlag = clearChunkReloadFlag

  override state: State = { hasError: false, error: null, reloading: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, reloading: false }
  }

  override componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) {
      try {
        const alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY)
        if (!alreadyReloaded) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
          this.setState({ reloading: true })
          window.location.reload()
        }
      } catch {
        // sessionStorage may throw in privacy-restricted sandboxes
      }
    }
  }

  override componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && this.props.resetKeys) {
      const changed = this.props.resetKeys.some(
        (key, idx) => key !== prevProps.resetKeys?.[idx],
      )
      if (changed) {
        this.setState({ hasError: false, error: null, reloading: false })
      }
    }
  }

  handleReload = () => {
    clearChunkReloadFlag()
    window.location.reload()
  }

  override render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          onReload={this.handleReload}
          reloading={this.state.reloading}
        />
      )
    }
    return this.props.children
  }
}
